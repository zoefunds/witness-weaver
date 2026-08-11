import type { FastifyInstance } from "fastify";
import { pool } from "../lib/db.js";
import { readContractView } from "../lib/genlayer.js";
import { config } from "../lib/config.js";

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

export async function evaluationSyncRoutes(app: FastifyInstance) {
  // Pulls the current on-chain state for a bounty and mirrors it into
  // Postgres: bounty status/verdict, each testimony's corroboration
  // outcome, and — the first time a bounty reaches RESOLVED — writes the
  // resulting reputation events and publishes its Truth Record. Safe to
  // call repeatedly; every write here is idempotent (upserts or
  // "if not already recorded" guards).
  app.post("/bounties/:id/sync-evaluation", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    const { id } = req.params as { id: string };

    const { rows: bountyRows } = await pool.query("select * from bounties where id = $1", [id]);
    const bounty = bountyRows[0];
    if (!bounty) return reply.code(404).send({ error: "bounty_not_found" });
    if (!bounty.chain_bounty_id) {
      return reply.code(409).send({ error: "bounty_not_on_chain" });
    }

    const chainBounty = await readContractView<ChainBounty>("get_bounty", [bounty.chain_bounty_id]);
    const testimonyIds = await readContractView<string[]>("get_bounty_testimonies", [bounty.chain_bounty_id]);

    const dbStatus = CHAIN_TO_DB_BOUNTY_STATUS[chainBounty.status] ?? bounty.status;
    await pool.query(
      `update bounties set status = $2, reward_claimed = $3, updated_at = now() where id = $1`,
      [id, dbStatus, chainBounty.reward_claimed],
    );

    // Upsert the evaluation row once a verdict exists on-chain.
    let evaluationId: string | null = null;
    if (chainBounty.verdict) {
      const { rows: existingEval } = await pool.query(
        "select id from evaluations where bounty_id = $1 order by created_at desc limit 1",
        [id],
      );
      const evalStatus = "confirmed"; // a non-empty verdict always means the nondet evaluation itself finished
      if (existingEval[0]) {
        evaluationId = existingEval[0].id;
        await pool.query(
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
        const { rows: inserted } = await pool.query(
          `insert into evaluations
            (bounty_id, status, verdict, confidence_bps, payout_bps, rationale, corroboration_json, requested_at, confirmed_at)
           values ($1,$2,$3,$4,$5,$6,$7, now(), now())
           returning id`,
          [
            id,
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

    // Sync each testimony's corroboration outcome.
    for (const chainTestimonyId of testimonyIds) {
      const chainTestimony = await readContractView<ChainTestimony>("get_testimony", [chainTestimonyId]);
      const newStatus = CHAIN_TO_DB_TESTIMONY_STATUS[chainTestimony.status];
      if (!newStatus) continue;
      await pool.query(
        "update testimonies set status = $2, consistency_bps = $3 where chain_testimony_id = $1",
        [chainTestimonyId, newStatus, chainTestimony.consistency_bps],
      );
    }

    // Once RESOLVED: write reputation events (once) and publish the Truth Record (once).
    if (dbStatus === "resolved" && evaluationId) {
      const { rows: alreadyRewarded } = await pool.query(
        "select 1 from reputation_events where bounty_id = $1 limit 1",
        [id],
      );
      if (alreadyRewarded.length === 0) {
        const { rows: testimonyRows } = await pool.query(
          "select submitter_id, status from testimonies where bounty_id = $1",
          [id],
        );
        for (const t of testimonyRows) {
          const delta =
            t.status === "corroborated"
              ? REPUTATION_DELTA_CORROBORATED
              : t.status === "rejected"
                ? REPUTATION_DELTA_REJECTED
                : REPUTATION_DELTA_DISPUTED;
          await pool.query(
            `insert into reputation_events (user_id, bounty_id, event_type, delta_bps, note)
             values ($1,$2,$3,$4,$5)`,
            [
              t.submitter_id,
              id,
              t.status === "corroborated" ? "testimony_corroborated" : "testimony_disputed",
              delta,
              `Bounty ${bounty.chain_bounty_id} resolved with verdict ${chainBounty.verdict}`,
            ],
          );
        }
      }

      const { rows: existingRecord } = await pool.query("select id from truth_records where bounty_id = $1", [id]);
      if (existingRecord.length === 0) {
        await pool.query(
          `insert into truth_records (bounty_id, evaluation_id, contract_address)
           values ($1, $2, $3)`,
          [id, evaluationId, config.genlayer.contractAddress],
        );
      }
    }

    return reply.send({ bounty: { ...bounty, status: dbStatus }, chainBounty });
  });
}
