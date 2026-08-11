import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.SESSION_JWT_SECRET ??= "test-secret-do-not-use-in-production";

const { buildSignInMessage, signSession, verifySession } = await import("../src/lib/auth.js");

test("buildSignInMessage includes the address and nonce, and is deterministic for the same inputs", () => {
  const message = buildSignInMessage("0xABC", "nonce123");
  assert.match(message, /0xABC/);
  assert.match(message, /nonce123/);
  assert.equal(message, buildSignInMessage("0xABC", "nonce123"));
});

test("signSession/verifySession round-trips the payload", () => {
  const token = signSession({ userId: "user-1", walletAddress: "0xabc" });
  const payload = verifySession(token);
  assert.equal(payload?.userId, "user-1");
  assert.equal(payload?.walletAddress, "0xabc");
});

test("verifySession rejects a tampered token", () => {
  const token = signSession({ userId: "user-1", walletAddress: "0xabc" });
  const tampered = token.slice(0, -2) + (token.at(-2) === "a" ? "b" : "a") + token.at(-1);
  assert.equal(verifySession(tampered), null);
});

test("verifySession rejects garbage input without throwing", () => {
  assert.equal(verifySession("not-a-real-jwt"), null);
});
