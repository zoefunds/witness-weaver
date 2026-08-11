import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifySession } from "../lib/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    session: { userId: string; walletAddress: string } | null;
  }
}

/**
 * Wires request-scoped session resolution directly onto the root app
 * instance. This is called directly — NOT via `app.register()` — because
 * Fastify's `.register()` creates a new encapsulated plugin context, and a
 * decorator/hook added inside an unwrapped plugin (no `fastify-plugin`
 * bypass) is only visible within that plugin's own context, not to sibling
 * route registrations. Every route file in this app is registered as its
 * own sibling plugin, so a `req.session` populated inside an encapsulated
 * authPlugin would silently never reach any of them — `req.session` would
 * stay null everywhere, and every authenticated route would 401 regardless
 * of a valid token. Calling this directly on `app` before any route
 * registrations avoids that trap entirely.
 */
export function attachAuthContext(app: FastifyInstance) {
  app.decorateRequest("session", null);

  app.addHook("preHandler", async (req: FastifyRequest) => {
    // Prefer a bearer token over the cookie. Frontend (Vercel) and backend
    // (Fly.io) are different sites, so the session cookie is a third-party
    // cookie from the browser's point of view — modern browsers increasingly
    // block or discard those by default regardless of SameSite=None. A
    // bearer token the frontend stores itself and attaches explicitly
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
