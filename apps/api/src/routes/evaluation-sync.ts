import type { FastifyInstance } from "fastify";
import { syncBountyEvaluation } from "../lib/sync-evaluation.js";

export async function evaluationSyncRoutes(app: FastifyInstance) {
  app.post("/bounties/:id/sync-evaluation", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    const { id } = req.params as { id: string };
    try {
      const result = await syncBountyEvaluation(id);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("bounty_not_found")) return reply.code(404).send({ error: "bounty_not_found" });
      if (message.startsWith("bounty_not_on_chain")) return reply.code(409).send({ error: "bounty_not_on_chain" });
      throw err;
    }
  });
}
