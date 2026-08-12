import type { FastifyInstance } from "fastify";
import { pool } from "../lib/db.js";

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    const { rows } = await pool.query(
      "select * from notifications where user_id = $1 order by created_at desc limit 50",
      [req.session.userId],
    );
    return reply.send({ notifications: rows });
  });

  app.get("/notifications/unread-count", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    const { rows } = await pool.query(
      "select count(*)::int as count from notifications where user_id = $1 and read_at is null",
      [req.session.userId],
    );
    return reply.send({ count: rows[0].count });
  });

  app.patch("/notifications/:id/read", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    const { id } = req.params as { id: string };
    const { rows } = await pool.query(
      "update notifications set read_at = now() where id = $1 and user_id = $2 returning id",
      [id, req.session.userId],
    );
    if (!rows[0]) return reply.code(404).send({ error: "notification_not_found" });
    return reply.send({ ok: true });
  });

  app.post("/notifications/read-all", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    await pool.query("update notifications set read_at = now() where user_id = $1 and read_at is null", [
      req.session.userId,
    ]);
    return reply.send({ ok: true });
  });
}
