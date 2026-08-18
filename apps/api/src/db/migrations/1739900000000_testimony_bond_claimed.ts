import type { MigrationBuilder } from "node-pg-migrate";

// get_testimony exposes the contract's bond state. Store it in the mirror so
// a successful claim immediately disappears from the witness's dashboard
// after the normal chain sync, rather than offering a guaranteed-to-fail
// second claim.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("testimonies", {
    bond_claimed: { type: "boolean", notNull: true, default: false },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn("testimonies", "bond_claimed");
}
