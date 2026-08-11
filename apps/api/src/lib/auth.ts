import { randomBytes } from "node:crypto";
import { verifyMessage } from "ethers";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { pool } from "./db.js";

// Nonces live in Postgres, not process memory: the API runs multiple
// Fly.io machines behind a load balancer, and the nonce issued by
// /auth/nonce needs to be readable by whichever machine happens to handle
// the follow-up /auth/verify call — an in-memory Map only works if both
// requests land on the exact same process, which they won't reliably.
const NONCE_TTL_MS = 5 * 60_000;

export async function issueNonce(address: string): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  await pool.query(
    `insert into login_nonces (wallet_address, nonce, expires_at)
     values ($1, $2, $3)
     on conflict (wallet_address) do update set nonce = excluded.nonce, expires_at = excluded.expires_at`,
    [address.toLowerCase(), nonce, expiresAt],
  );
  return nonce;
}

export function buildSignInMessage(address: string, nonce: string): string {
  return [
    "WitnessWeave wants you to sign in with your wallet.",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    "",
    "This request will not trigger a blockchain transaction or cost any gas.",
  ].join("\n");
}

export async function verifySignedNonce(address: string, signature: string): Promise<boolean> {
  const key = address.toLowerCase();
  const { rows } = await pool.query(
    "select nonce, expires_at from login_nonces where wallet_address = $1",
    [key],
  );
  const entry = rows[0];
  if (!entry || new Date(entry.expires_at).getTime() < Date.now()) {
    return false;
  }
  const message = buildSignInMessage(address, entry.nonce);
  let recovered: string;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    return false;
  }
  const ok = recovered.toLowerCase() === key;
  if (ok) {
    // one-time use, prevents signature replay
    await pool.query("delete from login_nonces where wallet_address = $1", [key]);
  }
  return ok;
}

export interface SessionPayload {
  userId: string;
  walletAddress: string;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, config.sessionJwtSecret, { expiresIn: "30d" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, config.sessionJwtSecret) as SessionPayload;
  } catch {
    return null;
  }
}
