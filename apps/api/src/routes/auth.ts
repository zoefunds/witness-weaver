import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { buildSignInMessage, issueNonce, signSession, verifySignedNonce } from "../lib/auth.js";
import { config } from "../lib/config.js";

const NonceRequestSchema = z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) });
const VerifyRequestSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  signature: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  // Step 1: frontend requests a nonce for the address the connected wallet reports.
  app.post("/auth/nonce", async (req, reply) => {
    const parsed = NonceRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_address" });

    const nonce = issueNonce(parsed.data.address);
    const message = buildSignInMessage(parsed.data.address, nonce);
    return reply.send({ message });
  });

  // Step 2: frontend has the wallet sign that exact message; we recover the
  // signer and, only if it matches the claimed address, issue a session.
  app.post("/auth/verify", async (req, reply) => {
    const parsed = VerifyRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_payload" });

    const { address, signature } = parsed.data;
    const ok = verifySignedNonce(address, signature);
    if (!ok) return reply.code(401).send({ error: "signature_verification_failed" });

    const normalized = address.toLowerCase();
    const { rows } = await pool.query(
      `insert into users (wallet_address)
       values ($1)
       on conflict (wallet_address) do update set updated_at = now()
       returning id, wallet_address`,
      [normalized],
    );
    const user = rows[0];
    const token = signSession({ userId: user.id, walletAddress: user.wallet_address });

    reply.setCookie("ww_session", token, {
      httpOnly: true,
      // Frontend (Vercel) and backend (Fly.io) are different domains, so
      // this is a cross-site request from the browser's point of view.
      // Cross-site cookies require SameSite=None + Secure — SameSite=Lax
      // (the safer default) is silently dropped on cross-site fetch calls,
      // which is why sign-in previously didn't persist. Locally, frontend
      // and backend are both on `localhost` (different ports only), which
      // the SameSite spec still treats as same-site, so `lax` there is
      // correct and doesn't require HTTPS.
      secure: config.env === "production",
      sameSite: config.env === "production" ? "none" : "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return reply.send({ user: { id: user.id, walletAddress: user.wallet_address } });
  });

  app.post("/auth/logout", async (req, reply) => {
    // clearCookie must be issued with the same SameSite/Secure attributes
    // the cookie was originally set with, or the browser won't match it.
    reply.clearCookie("ww_session", {
      path: "/",
      secure: config.env === "production",
      sameSite: config.env === "production" ? "none" : "lax",
    });
    return reply.send({ ok: true });
  });

  app.get("/auth/me", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    const { rows } = await pool.query(
      "select id, wallet_address, display_name, avatar_url, created_at from users where id = $1",
      [req.session.userId],
    );
    if (!rows[0]) return reply.code(404).send({ error: "user_not_found" });
    return reply.send({ user: rows[0] });
  });
}
