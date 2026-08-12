import type { MigrationBuilder } from "node-pg-migrate";

// Same class of bug as 1739700000000_bounty_reward_claimed: syncBountyEvaluation
// writes testimonies.consistency_bps (the per-testimony corroboration score
// from the contract's evaluation) but the column was never migrated in.
// Every sync for a bounty with testimonies has been throwing "column
// consistency_bps does not exist" and rolling back the whole transaction —
// which, now that syncBountyEvaluation runs atomically, blocks the bounty
// status/verdict update too, not just the testimony status.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("testimonies", {
    consistency_bps: { type: "integer" },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn("testimonies", "consistency_bps");
}
