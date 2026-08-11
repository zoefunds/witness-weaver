import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../lib/db.js";

// The GenLayer contract does the actual evaluation (evaluate_bounty/settle).
// The frontend calls those directly against the contract with the user's
// wallet; the backend only records the resulting transaction lifecycle so
// the UI can show real state after a page reload / on other devices, and so
// the truth_record + reputation_events can be derived once it's confirmed.
const EvaluationSyncSchema = z.object({
  status: z.enum([
    "idle",
    "preparing",
    "submitted",
    "pending",
    "confirmed",
    "failed",
    "timeout",
    "needs_human_review",
  ]),
  verdict: z.enum(["passed", "failed", "partial_pass", "needs_human_review"]).optional(),
  confidenceBps: z.number().int().min(0).max(10000).optional(),
  payoutBps: z.number().int().min(0).max(10000).optional(),
  rationale: z.string().max(4000).optional(),
  corroboration: z.record(z.string(), z.unknown()).optional(),
  evaluateTxHash: z.string().optional(),
  settleTxHash: z.string().optional(),
  errorMessage: z.string().max(1000).optional(),
});

export async function evaluationRoutes(app: FastifyInstance) {
  app.post("/bounties/:bountyId/evaluations", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    const { bountyId } = req.params as { bountyId: string };
    const { rows } = await pool.query(
      `insert into evaluations (bounty_id, status, requested_at) values ($1, 'preparing', now()) returning *`,
      [bountyId],
    );
    await pool.query("update bounties set status = 'evaluating', updated_at = now() where id = $1", [bountyId]);
    return reply.code(201).send({ evaluation: rows[0] });
  });

  app.patch("/evaluations/:id", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    const parsed = EvaluationSyncSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_payload", details: parsed.error.flatten() });
    const e = parsed.data;

    const { rows } = await pool.query(
      `update evaluations set
         status = $2,
         verdict = coalesce($3, verdict),
         confidence_bps = coalesce($4, confidence_bps),
         payout_bps = coalesce($5, payout_bps),
         rationale = coalesce($6, rationale),
         corroboration_json = coalesce($7, corroboration_json),
         evaluate_tx_hash = coalesce($8, evaluate_tx_hash),
         settle_tx_hash = coalesce($9, settle_tx_hash),
         error_message = coalesce($10, error_message),
         confirmed_at = case when $2 = 'confirmed' then now() else confirmed_at end
       where id = $1
       returning *`,
      [
        (req.params as { id: string }).id,
        e.status,
        e.verdict,
        e.confidenceBps,
        e.payoutBps,
        e.rationale,
        e.corroboration ? JSON.stringify(e.corroboration) : null,
        e.evaluateTxHash,
        e.settleTxHash,
        e.errorMessage,
      ],
    );
    if (!rows[0]) return reply.code(404).send({ error: "evaluation_not_found" });

    if (e.status === "confirmed") {
      const bountyStatus =
        e.verdict === "needs_human_review" ? "evaluating" : "resolved";
      await pool.query("update bounties set status = $2, updated_at = now() where id = $1", [
        rows[0].bounty_id,
        bountyStatus,
      ]);
    }
    return reply.send({ evaluation: rows[0] });
  });

  app.get("/bounties/:bountyId/evaluations", async (req, reply) => {
    const { bountyId } = req.params as { bountyId: string };
    const { rows } = await pool.query(
      "select * from evaluations where bounty_id = $1 order by created_at desc",
      [bountyId],
    );
    return reply.send({ evaluations: rows });
  });
}
