import type { MigrationBuilder } from "node-pg-migrate";

// Baseline Sybil-resistance backstop: one testimony per wallet per bounty,
// enforced at the database level (not just the API's pre-insert check,
// which has a race window under concurrent requests from the same user).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addConstraint("testimonies", "testimonies_unique_bounty_submitter", {
    unique: ["bounty_id", "submitter_id"],
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint("testimonies", "testimonies_unique_bounty_submitter");
}
