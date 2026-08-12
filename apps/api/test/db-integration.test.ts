import { test } from "node:test";
import assert from "node:assert/strict";

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

