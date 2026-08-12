import type { MigrationBuilder } from "node-pg-migrate";

// Tracks which deployed contract instance a bounty's on-chain state
// actually lives on. The contract has already been redeployed once during
// this project (a fresh instance, not an upgrade) — anything created
// against the old address is now permanently orphaned relative to whatever
// GENLAYER_CONTRACT_ADDRESS the app currently points at. Recording this
// per-bounty lets the UI warn about stale bounties instead of silently
// trying (and failing) to read/write them against the wrong contract.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("bounties", {
    contract_address: { type: "text" },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn("bounties", "contract_address");
}
