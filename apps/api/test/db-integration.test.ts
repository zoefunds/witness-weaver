import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.SESSION_JWT_SECRET ??= "test-secret-do-not-use-in-production";

// Requires a reachable DATABASE_URL (docker compose up -d postgres locally,
// or point at a real instance via a proxy tunnel). Every test here runs
// inside a transaction that's always rolled back, never committed — so
// this is safe to run against a real database, including production,
// without leaving any trace.
const { pool } = await import("../src/lib/db.js");

async function dbReachable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

test("testimonies: one submission per (bounty, submitter) is enforced at the DB level", { skip: !(await dbReachable()) }, async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: userRows } = await client.query(
      "insert into users (wallet_address) values ($1) returning id",
      [`0xtest${Date.now()}`],
    );
    const userId = userRows[0].id;

    const { rows: bountyRows } = await client.query(
      `insert into bounties (creator_id, title, description, incident_type, reward_wei, status)
       values ($1, 'Test bounty', 'Test bounty description long enough', 'Other', '1', 'open')
       returning id`,
      [userId],
    );
    const bountyId = bountyRows[0].id;

    await client.query(
      `insert into testimonies (bounty_id, submitter_id, statement, statement_hash)
       values ($1, $2, 'aaaaaaaaaaaaaaaaaaaa', 'hash1')`,
      [bountyId, userId],
    );

    await assert.rejects(
      () =>
        client.query(
          `insert into testimonies (bounty_id, submitter_id, statement, statement_hash)
           values ($1, $2, 'bbbbbbbbbbbbbbbbbbbb', 'hash2')`,
          [bountyId, userId],
        ),
      /duplicate key value violates unique constraint/,
    );

    await client.query("ROLLBACK");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

test("reputation_events: 'already rewarded' guard query returns nothing for a fresh bounty", { skip: !(await dbReachable()) }, async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: userRows } = await client.query(
      "insert into users (wallet_address) values ($1) returning id",
      [`0xtest${Date.now()}`],
    );
    const { rows: bountyRows } = await client.query(
      `insert into bounties (creator_id, title, description, incident_type, reward_wei, status)
       values ($1, 'Test bounty', 'Test bounty description long enough', 'Other', '1', 'resolved')
       returning id`,
      [userRows[0].id],
    );
    const { rows: existing } = await client.query("select 1 from reputation_events where bounty_id = $1 limit 1", [
      bountyRows[0].id,
    ]);
    assert.equal(existing.length, 0);
    await client.query("ROLLBACK");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

test("bounties.contract_address column exists (regression check for the redeploy-tracking migration)", { skip: !(await dbReachable()) }, async () => {
  const { rows } = await pool.query(
    "select column_name from information_schema.columns where table_name = 'bounties' and column_name = 'contract_address'",
  );
  assert.equal(rows.length, 1);
});

// This is opt-in because it writes a short-lived fixture (then deletes it),
// unlike the rollback-only schema checks above. It exercises the production
// sync function against contract view snapshots: first a resolved evaluation
// outcome, then the witness's completed bond refund.
test("E2E: contract testimony outcomes sync and a claimed witness bond is reflected", {
  skip: process.env.RUN_CHAIN_SYNC_E2E !== "1" || !(await dbReachable()),
}, async () => {
  const { syncBountyEvaluation } = await import("../src/lib/sync-evaluation.js");
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const creator = (await pool.query("insert into users (wallet_address) values ($1) returning id", [`0xcreator${suffix}`])).rows[0].id;
  const witness = (await pool.query("insert into users (wallet_address) values ($1) returning id", [`0xwitness${suffix}`])).rows[0].id;
  const bounty = (
    await pool.query(
      `insert into bounties (chain_bounty_id, contract_address, creator_id, title, description, incident_type, reward_wei, status)
       values ('bounty:e2e', '0x0000000000000000000000000000000000000001', $1, 'E2E bounty', 'A sufficiently long E2E bounty description', 'Other', '100', 'evaluating') returning id`,
      [creator],
    )
  ).rows[0].id;
  const testimony = (
    await pool.query(
      `insert into testimonies (chain_testimony_id, bounty_id, submitter_id, statement, statement_hash, bond_wei, bond_deposited_wei)
       values ('testimony:e2e', $1, $2, 'A sufficiently long E2E witness statement', 'hash', '25', '25') returning id`,
      [bounty, witness],
    )
  ).rows[0].id;

  let refunded = false;
  const readContractView = async <T>(name: string): Promise<T> => {
    if (name === "get_bounty") {
      return {
        bounty_id: "bounty:e2e", status: "RESOLVED", verdict: "PASSED", confidence_bps: 9000, payout_bps: 10000,
        rationale: "Corroborated", corroboration: { scores: { "testimony:e2e": { consistency_bps: 8800 } } }, reward_claimed: true,
      } as T;
    }
    if (name === "get_bounty_testimonies") return ["testimony:e2e"] as T;
    return {
      testimony_id: "testimony:e2e", status: "CORROBORATED", consistency_bps: 8800,
      bond_deposited: refunded ? "0" : "25", bond_claimed: refunded,
    } as T;
  };

  try {
    await syncBountyEvaluation(bounty, { readContractView, contractAddress: "0x0000000000000000000000000000000000000001" });
    let row = (await pool.query("select status, consistency_bps, bond_deposited_wei, bond_claimed from testimonies where id = $1", [testimony])).rows[0];
    assert.deepEqual(row, { status: "corroborated", consistency_bps: 8800, bond_deposited_wei: "25", bond_claimed: false });

    refunded = true; // snapshot after claim_bond_refund has finalized on-chain
    await syncBountyEvaluation(bounty, { readContractView, contractAddress: "0x0000000000000000000000000000000000000001" });
    row = (await pool.query("select bond_deposited_wei, bond_claimed from testimonies where id = $1", [testimony])).rows[0];
    assert.deepEqual(row, { bond_deposited_wei: "0", bond_claimed: true });
  } finally {
    await pool.query("delete from truth_records where bounty_id = $1", [bounty]);
    await pool.query("delete from bounties where id = $1", [bounty]);
    await pool.query("delete from users where id = any($1::uuid[])", [[creator, witness]]);
  }
});
