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
    // Prefer a bearer token over the cookie. Frontend (Vercel) and backend
    // (Fly.io) are different sites, so the session cookie is a third-party
    // cookie from the browser's point of view — modern browsers increasingly
    // block or discard those by default regardless of SameSite=None, which
    // showed up as users getting bounced back to "Sign in" while navigating.
    // A bearer token the frontend stores itself and attaches explicitly
    // sidesteps third-party cookie policy entirely; the cookie is kept only
    // as a same-origin-friendly fallback for local development.
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
    const token = bearerToken ?? req.cookies?.ww_session;
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
