import { randomBytes } from "node:crypto";
import { verifyMessage } from "ethers";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

// Short-lived in-memory nonce store. A single always-on Fly.io machine holds
// this in process memory; if scaled beyond one machine this must move to a
// shared store (Postgres or Redis) since wallet auth is a two-step handshake.
const pendingNonces = new Map<string, { nonce: string; expiresAt: number }>();
const NONCE_TTL_MS = 5 * 60_000;

export function issueNonce(address: string): string {
  const nonce = randomBytes(16).toString("hex");
  pendingNonces.set(address.toLowerCase(), { nonce, expiresAt: Date.now() + NONCE_TTL_MS });
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

export function verifySignedNonce(address: string, signature: string): boolean {
  const key = address.toLowerCase();
  const entry = pendingNonces.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
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
  if (ok) pendingNonces.delete(key); // one-time use, prevents signature replay
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
