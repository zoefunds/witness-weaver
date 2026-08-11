import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifySession } from "../lib/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    session: { userId: string; walletAddress: string } | null;
  }
}

export async function authPlugin(app: FastifyInstance) {
  app.decorateRequest("session", null);

  app.addHook("preHandler", async (req: FastifyRequest) => {
    const token = req.cookies?.ww_session;
    req.session = token ? verifySession(token) : null;
  });
}

export function requireAuth(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (!req.session) {
    reply.code(401).send({ error: "authentication_required" });
    return;
  }
  done();
}
