import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { config } from "../lib/config.js";

const CreateBountySchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(20).max(5000),
  incidentType: z.string().min(2).max(80),
  incidentOccurredAt: z.string().datetime().optional(),
  locationContext: z.string().max(500).optional(),
  evidenceRequirements: z.string().max(2000).optional(),
  witnessBondWei: z.string().regex(/^\d+$/).default("0"),
  rewardWei: z.string().regex(/^\d+$/),
  visibility: z.enum(["public", "unlisted"]).default("public"),
  submissionDeadline: z.string().datetime().optional(),
});

// Mirrors of on-chain transaction lifecycle progress reported by the frontend
// as the wallet-signed create_bounty transaction moves through its states.
const TxSyncSchema = z.object({
  chainBountyId: z.string().optional(),
  createTxHash: z.string().optional(),
  status: z.enum(["pending_escrow", "open", "cancelled"]).optional(),
  rewardDepositedWei: z.string().regex(/^\d+$/).optional(),
});

export async function bountyRoutes(app: FastifyInstance) {
  // Draft creation: the DB row exists before the on-chain escrow tx is sent,
  // so the frontend has something to attach the tx hash to as soon as the
  // user signs. Nothing is "open" for testimony until chain confirms escrow.
  app.post("/bounties", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    const parsed = CreateBountySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_payload", details: parsed.error.flatten() });
    const b = parsed.data;

    const { rows } = await pool.query(
      `insert into bounties
        (creator_id, title, description, incident_type, incident_occurred_at, location_context,
         evidence_requirements, witness_bond_wei, reward_wei, visibility, submission_deadline, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft')
       returning *`,
      [
        req.session.userId,
        b.title,
        b.description,
        b.incidentType,
        b.incidentOccurredAt ?? null,
        b.locationContext ?? null,
        b.evidenceRequirements ?? null,
        b.witnessBondWei,
        b.rewardWei,
        b.visibility,
        b.submissionDeadline ?? null,
      ],
    );
    return reply.code(201).send({ bounty: rows[0] });
  });

  // Called by the frontend once the wallet-signed create_bounty tx is
  // submitted/confirmed, to sync the off-chain mirror with on-chain truth.
  app.patch("/bounties/:id/chain-sync", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    const parsed = TxSyncSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_payload" });

    const { rows: owned } = await pool.query("select creator_id from bounties where id = $1", [
      (req.params as { id: string }).id,
    ]);
    if (!owned[0]) return reply.code(404).send({ error: "bounty_not_found" });
    if (owned[0].creator_id !== req.session.userId) return reply.code(403).send({ error: "not_owner" });

    const s = parsed.data;
    // Recorded once, at the point escrow actually confirms — this is what
    // lets the UI later detect a bounty whose on-chain data lives on a
    // contract address the app no longer points at (e.g. after a redeploy),
    // rather than silently failing reads/writes against the wrong contract.
    const contractAddress = s.chainBountyId ? config.genlayer.contractAddress : null;
    const { rows } = await pool.query(
      `update bounties set
         chain_bounty_id = coalesce($2, chain_bounty_id),
         create_tx_hash = coalesce($3, create_tx_hash),
         status = coalesce($4, status),
         reward_deposited_wei = coalesce($5, reward_deposited_wei),
         contract_address = coalesce($6, contract_address),
         updated_at = now()
       where id = $1
       returning *`,
      [(req.params as { id: string }).id, s.chainBountyId, s.createTxHash, s.status, s.rewardDepositedWei, contractAddress],
    );
    return reply.send({ bounty: rows[0] });
  });

  app.get("/bounties", async (req, reply) => {
    const q = req.query as { status?: string; limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 20), 50);
    const offset = Number(q.offset ?? 0);
    const params: unknown[] = [];
    let where = "where visibility = 'public'";
    if (q.status) {
      params.push(q.status);
      where += ` and status = $${params.length}`;
    }
    params.push(limit, offset);
    const { rows } = await pool.query(
      `select * from bounties ${where} order by created_at desc limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return reply.send({ bounties: rows });
  });

  app.get("/bounties/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query("select * from bounties where id = $1", [id]);
    if (!rows[0]) return reply.code(404).send({ error: "bounty_not_found" });

    const [{ rows: testimonies }, { rows: evaluation }] = await Promise.all([
      pool.query("select * from testimonies where bounty_id = $1 order by created_at asc", [id]),
      pool.query("select * from evaluations where bounty_id = $1 order by created_at desc limit 1", [id]),
    ]);

    return reply.send({ bounty: rows[0], testimonies, evaluation: evaluation[0] ?? null });
  });
}
