import type { FastifyInstance } from "fastify";
import { pool } from "../lib/db.js";

// Fly.io hits this on the configured http health check interval; a failing
// check triggers a machine restart, which is what keeps the API 24/7.
export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return reply.send({ status: "ok", db: "up", time: new Date().toISOString() });
    } catch (err) {
      app.log.error(err, "health check failed: database unreachable");
      return reply.code(503).send({ status: "degraded", db: "down" });
    }
  });
}
