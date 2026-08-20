import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccount, createClient } from "genlayer-js";
import { localnet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

// This process is deliberately isolated from the normal unit tests. It talks
// to an actual GenLayer simulator and never replaces readContractView or
// syncBountyEvaluation dependencies with a mock.
process.env.DATABASE_URL ??= "postgres://witnessweave:changeme@localhost:5432/witnessweave";
process.env.SESSION_JWT_SECRET ??= "test-secret-do-not-use-in-production";
process.env.GENLAYER_NETWORK = "localnet";
process.env.GENLAYER_RPC_URL ??= "http://127.0.0.1:4000/api";

const enabled = process.env.RUN_GENLAYER_REFUND_E2E === "1";
const rpcUrl = process.env.GENLAYER_RPC_URL;
// The current local simulator runs the Hardhat chain configured in its
// compose environment (61999); genlayer-js 0.3x still labels `localnet` as
// 61127. Use the simulator's actual signing chain while retaining its ABI
// and RPC configuration.
const simulatorChain = { ...localnet, id: 61999 };

function fromReceipt(receipt: unknown): string {
  const receipts = (receipt as { consensus_data?: { leader_receipt?: unknown[] } }).consensus_data?.leader_receipt;
  assert.ok(receipts?.length, "write must include at least one finalized leader receipt");
  const ids = receipts.flatMap((entry) => {
    const result = (entry as { result?: unknown }).result;
    const readable =
      typeof result === "object" && result !== null
        ? (result as { payload?: { readable?: unknown } }).payload?.readable
        : result;
    if (typeof readable !== "string") return [];
    try {
      const decoded: unknown = JSON.parse(readable);
      if (typeof decoded !== "string") throw new Error("contract return must decode to an id string");
      return [decoded];
    } catch {
      return [readable];
    }
  });
  assert.ok(ids.length, "write must include a contract-generated id return value");
  assert.ok(ids.every((id) => id === ids[0]), "leader receipts must agree on the exact contract-generated id");
  return ids[0];
}

async function view<T>(client: ReturnType<typeof createClient>, address: `0x${string}`, functionName: string, args: unknown[] = []): Promise<T> {
  const result = await client.readContract({
    address,
    functionName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- contract call shapes vary by view
    args: args as any,
  });
  return (typeof result === "string" ? JSON.parse(result) : result) as T;
}

async function waitForEvaluationTimeout(
  client: ReturnType<typeof createClient>,
  address: `0x${string}`,
  bountyId: string,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    const bounty = await view<{ evaluation_timeout_ts: number }>(client, address, "get_bounty", [bountyId]);
    const now = await view<number>(client, address, "get_current_time");
    if (now > bounty.evaluation_timeout_ts) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("GenLayer localnet did not advance past the bounty evaluation timeout within 90 seconds");
}

test(
  "E2E: real claim_bond_refund changes contract state and production sync mirrors it",
  { skip: !enabled, timeout: 150_000 },
  async () => {
    const { pool } = await import("../src/lib/db.js");
    const { config } = await import("../src/lib/config.js");
    const { syncBountyEvaluation } = await import("../src/lib/sync-evaluation.js");

    const creator = createAccount();
    const witness = createAccount();
    const creatorClient = createClient({ chain: simulatorChain, endpoint: rpcUrl, account: creator });
    const witnessClient = createClient({ chain: simulatorChain, endpoint: rpcUrl, account: witness });
    const publicClient = createClient({ chain: simulatorChain, endpoint: rpcUrl });
    // fundAccount is a simulator-only helper which currently checks object
    // identity against the SDK's legacy localnet definition. It does not sign
    // or execute a contract transaction; signed calls use simulatorChain.
    const faucet = createClient({ chain: localnet, endpoint: rpcUrl }) as ReturnType<typeof createClient> & {
      fundAccount: (args: { address: `0x${string}`; amount: number }) => Promise<unknown>;
    };
    const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;

    // Localnet's simulator faucet funds generated, test-only accounts. These
    // writes are never sent to StudioNet or a production contract.
    await faucet.fundAccount({ address: creator.address, amount: 1_000_000 });
    await faucet.fundAccount({ address: witness.address, amount: 1_000_000 });

    const contractCode = await readFile(new URL("../../../contracts/witnessweave_contract.py", import.meta.url), "utf8");
    const deploymentTx = await creatorClient.deployContract({ code: contractCode, args: [] });
    const deployment = await creatorClient.waitForTransactionReceipt({
      hash: deploymentTx as any,
      status: TransactionStatus.ACCEPTED,
      interval: 250,
      retries: 80,
    });
    const contractAddress = ((deployment as { data?: { contract_address?: unknown }; txDataDecoded?: { contractAddress?: unknown } }).data
      ?.contract_address ?? (deployment as { txDataDecoded?: { contractAddress?: unknown } }).txDataDecoded?.contractAddress) as unknown;
    assert.match(String(contractAddress), /^0x[a-fA-F0-9]{40}$/);
    const address = contractAddress as `0x${string}`;

    // Point the production API reader at the actual localnet contract. There
    // is no read mock and syncBountyEvaluation is called with no overrides.
    config.genlayer.network = "localnet";
    config.genlayer.rpcUrl = rpcUrl;
    config.genlayer.contractAddress = address;

    const createTx = await creatorClient.writeContract({
      address,
      functionName: "create_bounty",
      args: ["E2E bonded refund", "A real contract-backed refund integration test", "", 25, 60, 1],
      value: 100n,
    });
    const createReceipt = await creatorClient.waitForTransactionReceipt({
      hash: createTx as any,
      status: TransactionStatus.ACCEPTED,
      interval: 250,
      retries: 80,
    });
    const chainBountyId = fromReceipt(createReceipt);

    const submitTx = await witnessClient.writeContract({
      address,
      functionName: "submit_testimony",
      args: [chainBountyId, "e2e-statement-hash", "[]", false],
      value: 25n,
    });
    const submitReceipt = await witnessClient.waitForTransactionReceipt({
      hash: submitTx as any,
      status: TransactionStatus.ACCEPTED,
      interval: 250,
      retries: 80,
    });
    const chainTestimonyId = fromReceipt(submitReceipt);

    const creatorId = (await pool.query("insert into users (wallet_address) values ($1) returning id", [creator.address])).rows[0].id;
    const witnessId = (await pool.query("insert into users (wallet_address) values ($1) returning id", [witness.address])).rows[0].id;
    const bountyId = (
      await pool.query(
        `insert into bounties (chain_bounty_id, contract_address, creator_id, title, description, incident_type, reward_wei, status)
         values ($1, $2, $3, 'E2E bonded refund', 'A real contract-backed refund integration test', 'Other', '100', 'draft')
         returning id`,
        [chainBountyId, address, creatorId],
      )
    ).rows[0].id;
    const testimonyId = (
      await pool.query(
        `insert into testimonies (chain_testimony_id, bounty_id, submitter_id, statement, statement_hash, bond_wei, bond_deposited_wei)
         values ($1, $2, $3, 'A real E2E witness statement', 'e2e-statement-hash', '25', '0') returning id`,
        [chainTestimonyId, bountyId, witnessId],
      )
    ).rows[0].id;

    try {
      // First sync proves the API reads the real submitted testimony and its
      // actual deposited bond, rather than test-supplied snapshot data.
      await syncBountyEvaluation(bountyId);
      let row = (await pool.query("select status, bond_deposited_wei, bond_claimed from testimonies where id = $1", [testimonyId])).rows[0];
      assert.deepEqual(row, { status: "submitted", bond_deposited_wei: "25", bond_claimed: false });

      await waitForEvaluationTimeout(publicClient, address, chainBountyId);
      const timeoutTx = await creatorClient.writeContract({ address, functionName: "claim_timeout_refund", args: [chainBountyId], value: 0n });
      await creatorClient.waitForTransactionReceipt({ hash: timeoutTx as any, status: TransactionStatus.ACCEPTED, interval: 250, retries: 80 });

      // This is the contract write the review requested. Its postcondition is
      // read directly from the deployed contract before the API performs any
      // database synchronization.
      const refundTx = await witnessClient.writeContract({ address, functionName: "claim_bond_refund", args: [chainTestimonyId], value: 0n });
      await witnessClient.waitForTransactionReceipt({ hash: refundTx as any, status: TransactionStatus.ACCEPTED, interval: 250, retries: 80 });
      const chainTestimony = await view<{ bond_deposited: string; bond_claimed: boolean }>(publicClient, address, "get_testimony", [chainTestimonyId]);
      assert.equal(chainTestimony.bond_deposited, "0");
      assert.equal(chainTestimony.bond_claimed, true);

      await syncBountyEvaluation(bountyId);
      row = (await pool.query("select status, bond_deposited_wei, bond_claimed from testimonies where id = $1", [testimonyId])).rows[0];
      assert.deepEqual(row, { status: "submitted", bond_deposited_wei: "0", bond_claimed: true });
      const dbBounty = (await pool.query("select status from bounties where id = $1", [bountyId])).rows[0];
      assert.equal(dbBounty.status, "timed_out");
    } finally {
      await pool.query("delete from truth_records where bounty_id = $1", [bountyId]);
      await pool.query("delete from bounties where id = $1", [bountyId]);
      await pool.query("delete from users where id = any($1::uuid[])", [[creatorId, witnessId]]);
      await pool.end();
    }
  },
);
