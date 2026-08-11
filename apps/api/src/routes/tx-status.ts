import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../lib/db.js";

const LogTxSchema = z.object({
  subjectType: z.enum(["bounty", "testimony", "evaluation"]),
  subjectId: z.string().uuid(),
  action: z.string().min(2).max(60),
  txHash: z.string().optional(),
  status: z.enum([
    "idle",
    "preparing",
    "wallet_check",
    "requested",
    "submitted",
    "pending",
    "confirmed",
    "rejected",
    "failed",
    "timeout",
    "backend_sync_failed",
  ]),
  errorMessage: z.string().max(1000).optional(),
});

// Generic append log the frontend writes to at every step of the transaction
// lifecycle (idle -> preparing -> wallet check -> submitted -> pending ->
// confirmed | rejected | failed | timeout). Lets a user reload the page or
// switch devices and still see exactly where a pending transaction stands.
export async function txStatusRoutes(app: FastifyInstance) {
  app.post("/tx-status", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    const parsed = LogTxSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_payload" });
    const t = parsed.data;

    const { rows } = await pool.query(
      `insert into tx_status_log (user_id, subject_type, subject_id, action, tx_hash, status, error_message)
       values ($1,$2,$3,$4,$5,$6,$7)
       returning *`,
      [req.session.userId, t.subjectType, t.subjectId, t.action, t.txHash ?? null, t.status, t.errorMessage ?? null],
    );
    return reply.code(201).send({ entry: rows[0] });
  });

  app.get("/tx-status/:subjectType/:subjectId", async (req, reply) => {
    const { subjectType, subjectId } = req.params as { subjectType: string; subjectId: string };
    const { rows } = await pool.query(
      "select * from tx_status_log where subject_type = $1 and subject_id = $2 order by created_at desc",
      [subjectType, subjectId],
    );
    return reply.send({ log: rows });
  });
}
