import type { MigrationBuilder } from "node-pg-migrate";

// chain_bounty_id was globally unique, but the contract's own ids are a
// simple per-deployment sequence ("bounty:0", "bounty:1", ...) that
// restarts at 0 every time the contract is redeployed — which has already
// happened once. A bounty on the new contract legitimately collides with
// an orphaned bounty on the old one under a global constraint. Uniqueness
// needs to be scoped to (contract_address, chain_bounty_id) instead.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint("bounties", "bounties_chain_bounty_id_key", { ifExists: true });
  pgm.addConstraint("bounties", "bounties_unique_contract_chain_bounty", {
    unique: ["contract_address", "chain_bounty_id"],
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint("bounties", "bounties_unique_contract_chain_bounty");
  pgm.addConstraint("bounties", "bounties_chain_bounty_id_key", { unique: "chain_bounty_id" });
}
