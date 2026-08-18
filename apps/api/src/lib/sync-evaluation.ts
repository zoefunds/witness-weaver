import { pool } from "./db.js";
import { readContractView } from "./genlayer.js";
import { config } from "./config.js";
import { notify } from "./notify.js";

type SyncDependencies = {
  readContractView: typeof readContractView;
  contractAddress: string;
};

interface ChainBounty {
  bounty_id: string;
  status: string;
  verdict: string;
  confidence_bps: number;
  payout_bps: number;
  rationale: string;
  corroboration: { scores?: Record<string, { consistency_bps: number }> } | null;
  reward_claimed: boolean;
}

interface ChainTestimony {
  testimony_id: string;
  status: string;
  consistency_bps: number;
  bond_deposited: string;
  bond_claimed: boolean;
}

const CHAIN_TO_DB_BOUNTY_STATUS: Record<string, string> = {
  OPEN: "open",
  EVALUATING: "evaluating",
  EVALUATED: "evaluating", // verdict exists, but funds haven't settled yet
  RESOLVED: "resolved",
  CANCELLED: "cancelled",
  TIMED_OUT: "timed_out",
};

const CHAIN_TO_DB_TESTIMONY_STATUS: Record<string, string> = {
  SUBMITTED: "submitted",
  CORROBORATED: "corroborated",
  DISPUTED: "disputed",
  REJECTED: "rejected",
};

// Reputation deltas are expressed in bps of the same 0-10000 scale
// reputation.ts's decayed score uses. Kept as named constants (not
// buried magic numbers) so the weighting is a single, auditable place to
// tune — corroborated testimony is rewarded more than disputed testimony
// is penalized, since a genuine good-faith but ultimately unconvincing
// account shouldn't be punished as harshly as deliberately false ones.
const REPUTATION_DELTA_CORROBORATED = 600;
const REPUTATION_DELTA_DISPUTED = -300;
const REPUTATION_DELTA_REJECTED = -800;

/**
 * Pulls the current on-chain state for a bounty and mirrors it into
 * Postgres: bounty status/verdict, each testimony's corroboration outcome,
 * and — the first time a bounty reaches RESOLVED — writes the resulting
 * reputation events and publishes its Truth Record. Safe to call
 * repeatedly; every write here is idempotent (upserts or "if not already
 * recorded" guards). Shared by the HTTP route (routes/evaluation-sync.ts,
 * for the frontend to call right after a wallet-signed tx confirms) and
 * the backend's own automation loop (lib/deadline-watcher.ts, for
 * bounties nobody's actively watching in a browser).
 */
export async function syncBountyEvaluation(
  bountyId: string,
  dependencies: Partial<SyncDependencies> = {},
) {
  const chainRead = dependencies.readContractView ?? readContractView;
  const contractAddress = dependencies.contractAddress ?? config.genlayer.contractAddress;
  // Everything below used to run as separate pool.query calls, each
  // grabbing whatever connection was free — a transient connection drop
  // partway through (confirmed happening on this DB) could let the bounty
  // status/evaluation writes land while the later reputation_events/
  // truth_records writes silently never ran, with no error surfaced to the
  // caller. A single transaction on one client makes the whole sync
  // atomic: either all of it lands, or none of it does, and the deadline-
  // watcher's per-bounty try/catch will correctly retry it next tick.
  const client = await pool.connect();
  try {
    await client.query("begin");

    const { rows: bountyRows } = await client.query("select * from bounties where id = $1", [bountyId]);
    const bounty = bountyRows[0];
    if (!bounty) throw new Error(`bounty_not_found: ${bountyId}`);
    if (!bounty.chain_bounty_id) throw new Error(`bounty_not_on_chain: ${bountyId}`);

    const chainBounty = await chainRead<ChainBounty>("get_bounty", [bounty.chain_bounty_id]);
    const testimonyIds = await chainRead<string[]>("get_bounty_testimonies", [bounty.chain_bounty_id]);

    const dbStatus = CHAIN_TO_DB_BOUNTY_STATUS[chainBounty.status] ?? bounty.status;
    await client.query(`update bounties set status = $2, reward_claimed = $3, updated_at = now() where id = $1`, [
      bountyId,
      dbStatus,
      chainBounty.reward_claimed,
    ]);

    let evaluationId: string | null = null;
    if (chainBounty.verdict) {
      const { rows: existingEval } = await client.query(
        "select id from evaluations where bounty_id = $1 order by created_at desc limit 1",
        [bountyId],
      );
      const evalStatus = "confirmed"; // a non-empty verdict always means the nondet evaluation itself finished
      if (existingEval[0]) {
        evaluationId = existingEval[0].id;
        await client.query(
          `update evaluations set status = $2, verdict = $3, confidence_bps = $4, payout_bps = $5,
             rationale = $6, corroboration_json = $7, confirmed_at = coalesce(confirmed_at, now())
           where id = $1`,
          [
            evaluationId,
            evalStatus,
            chainBounty.verdict.toLowerCase(),
            chainBounty.confidence_bps,
            chainBounty.payout_bps,
            chainBounty.rationale,
            JSON.stringify(chainBounty.corroboration ?? {}),
          ],
        );
      } else {
        const { rows: inserted } = await client.query(
          `insert into evaluations
            (bounty_id, status, verdict, confidence_bps, payout_bps, rationale, corroboration_json, requested_at, confirmed_at)
           values ($1,$2,$3,$4,$5,$6,$7, now(), now())
           returning id`,
          [
            bountyId,
            evalStatus,
            chainBounty.verdict.toLowerCase(),
            chainBounty.confidence_bps,
            chainBounty.payout_bps,
            chainBounty.rationale,
            JSON.stringify(chainBounty.corroboration ?? {}),
          ],
        );
        evaluationId = inserted[0].id;
      }
    }

    for (const chainTestimonyId of testimonyIds) {
      const chainTestimony = await chainRead<ChainTestimony>("get_testimony", [chainTestimonyId]);
      const newStatus = CHAIN_TO_DB_TESTIMONY_STATUS[chainTestimony.status];
      if (!newStatus) continue;
      await client.query(
        `update testimonies set
           status = $2, consistency_bps = $3, bond_deposited_wei = $4, bond_claimed = $5
         where chain_testimony_id = $1`,
        [
        chainTestimonyId,
        newStatus,
        chainTestimony.consistency_bps,
        chainTestimony.bond_deposited,
        chainTestimony.bond_claimed,
        ],
      );
    }

    let justResolved = false;
    if (dbStatus === "resolved" && evaluationId) {
      const { rows: alreadyRewarded } = await client.query(
        "select 1 from reputation_events where bounty_id = $1 limit 1",
        [bountyId],
      );
      if (alreadyRewarded.length === 0) {
        const { rows: testimonyRows } = await client.query(
          "select submitter_id, status from testimonies where bounty_id = $1",
          [bountyId],
        );
        for (const t of testimonyRows) {
          const delta =
            t.status === "corroborated"
              ? REPUTATION_DELTA_CORROBORATED
              : t.status === "rejected"
                ? REPUTATION_DELTA_REJECTED
                : REPUTATION_DELTA_DISPUTED;
          await client.query(
            `insert into reputation_events (user_id, bounty_id, event_type, delta_bps, note)
             values ($1,$2,$3,$4,$5)`,
            [
              t.submitter_id,
              bountyId,
              t.status === "corroborated" ? "testimony_corroborated" : "testimony_disputed",
              delta,
              `Bounty ${bounty.chain_bounty_id} resolved with verdict ${chainBounty.verdict}`,
            ],
          );
        }
      }

      const { rows: existingRecord } = await client.query("select id from truth_records where bounty_id = $1", [
        bountyId,
      ]);
      if (existingRecord.length === 0) {
        await client.query(
          `insert into truth_records (bounty_id, evaluation_id, contract_address)
           values ($1, $2, $3)`,
          [bountyId, evaluationId, contractAddress],
        );
        justResolved = true;
      }
    }

    await client.query("commit");

    if (justResolved) {
      const notifyPayload = { bountyId, bountyTitle: bounty.title, verdict: chainBounty.verdict };
      const recipientIds = new Set<string>([bounty.creator_id]);
      for (const t of (await pool.query("select submitter_id from testimonies where bounty_id = $1", [bountyId]))
        .rows) {
        recipientIds.add(t.submitter_id);
      }
      for (const userId of recipientIds) {
        await notify(userId, "bounty_resolved", notifyPayload);
      }
    }

    return { bounty: { ...bounty, status: dbStatus }, chainBounty };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
