import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { config } from "../lib/config.js";

const PublishSchema = z.object({
  bountyId: z.string().uuid(),
  evaluationId: z.string().uuid(),
  finalStateRoot: z.string().optional(),
});

export async function truthRecordRoutes(app: FastifyInstance) {
  // Published once a confirmed evaluation with a final verdict exists. This
  // row is a read-optimized mirror; the authoritative record is the
  // contract's on-chain state, linked here via contract_address.
  app.post("/truth-records", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    const parsed = PublishSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_payload" });

    const { rows: evalRows } = await pool.query(
      "select status, verdict from evaluations where id = $1 and bounty_id = $2",
      [parsed.data.evaluationId, parsed.data.bountyId],
    );
    if (!evalRows[0]) return reply.code(404).send({ error: "evaluation_not_found" });
    if (evalRows[0].status !== "confirmed" || !evalRows[0].verdict) {
      return reply.code(409).send({ error: "evaluation_not_finalized" });
    }
    if (!config.genlayer.contractAddress) {
      return reply.code(500).send({ error: "contract_not_configured" });
    }

    const { rows } = await pool.query(
      `insert into truth_records (bounty_id, evaluation_id, contract_address, final_state_root)
       values ($1,$2,$3,$4)
       on conflict (bounty_id) do update set evaluation_id = excluded.evaluation_id, final_state_root = excluded.final_state_root
       returning *`,
      [parsed.data.bountyId, parsed.data.evaluationId, config.genlayer.contractAddress, parsed.data.finalStateRoot ?? null],
    );
    return reply.code(201).send({ truthRecord: rows[0] });
  });

  app.get("/truth-records/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query(
      `select tr.*, b.title, b.description, b.incident_type, e.verdict, e.confidence_bps, e.payout_bps,
              e.rationale, e.corroboration_json, e.settle_tx_hash
       from truth_records tr
       join bounties b on b.id = tr.bounty_id
       join evaluations e on e.id = tr.evaluation_id
       where tr.id = $1`,
      [id],
    );
    if (!rows[0]) return reply.code(404).send({ error: "truth_record_not_found" });
    return reply.send({ truthRecord: rows[0] });
  });

  app.get("/bounties/:bountyId/truth-record", async (req, reply) => {
    const { bountyId } = req.params as { bountyId: string };
    const { rows } = await pool.query("select id from truth_records where bounty_id = $1", [bountyId]);
    if (!rows[0]) return reply.code(404).send({ error: "truth_record_not_found" });
    return reply.send({ truthRecordId: rows[0].id });
  });

  app.get("/truth-records", async (req, reply) => {
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 20), 50);
    const offset = Number(q.offset ?? 0);
    const { rows } = await pool.query(
      `select tr.id, tr.published_at, b.title, b.incident_type, e.verdict, e.confidence_bps
       from truth_records tr
       join bounties b on b.id = tr.bounty_id
       join evaluations e on e.id = tr.evaluation_id
       order by tr.published_at desc
       limit $1 offset $2`,
      [limit, offset],
    );
    return reply.send({ truthRecords: rows });
  });
}
