import type { MigrationBuilder } from "node-pg-migrate";

// login_nonces backs the wallet sign-in handshake (issueNonce/verifySignedNonce
// in lib/auth.ts). It must be a shared store, not in-process memory: the API
// runs multiple Fly.io machines behind a load balancer for zero-downtime
// deploys, and a nonce issued by one machine needs to be verifiable by
// whichever machine happens to receive the follow-up /auth/verify request.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("login_nonces", {
    wallet_address: { type: "text", primaryKey: true },
    nonce: { type: "text", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("login_nonces");
}
