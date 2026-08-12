import type { MigrationBuilder } from "node-pg-migrate";

// syncBountyEvaluation (lib/sync-evaluation.ts) has been writing the
// contract's reward_claimed flag into this column since the timestamp
// rewrite, but the column itself was never migrated in — every sync call
// (both the frontend's manual one and the deadline-watcher's automated one)
// has been throwing "column reward_claimed does not exist" and rolling back
// silently, which is why bounty status/verdict never advanced past OPEN in
// Postgres even after evaluate_bounty succeeded on-chain.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("bounties", {
    reward_claimed: { type: "boolean", notNull: true, default: false },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn("bounties", "reward_claimed");
}
