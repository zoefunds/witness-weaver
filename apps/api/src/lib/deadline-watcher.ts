import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { FastifyBaseLogger } from "fastify";
import { config } from "./config.js";
import { pool } from "./db.js";
import { readContractView } from "./genlayer.js";
import { syncBountyEvaluation } from "./sync-evaluation.js";

interface ChainBounty {
  status: string;
  testimony_count: number;
  submission_deadline_ts: number;
  evaluation_timeout_ts: number;
  verdict: string;
}

const POLL_INTERVAL_MS = Number(process.env.DEADLINE_WATCHER_INTERVAL_MS ?? 180_000);

/**
 * Closes out bounties nobody's actively watching in a browser. GenVM
 * patches Python's datetime.now() to a real, consensus-agreed block
 * timestamp (confirmed against a working sibling GenLayer contract's own
 * usage — this is not an invented virtual clock), so the contract's
 * submission_deadline_ts/evaluation_timeout_ts are genuine wall-clock
 * deadlines. This loop periodically checks every open/evaluating bounty in
 * our off-chain mirror and, once a deadline has actually passed on-chain:
 *
 *   - submission window closed, testimony exists  -> calls evaluate_bounty
 *   - evaluation finished with a settleable verdict -> calls settle
 *   - evaluation timeout passed, still unresolved   -> calls claim_timeout_refund
 *
 * all three of evaluate_bounty/settle/claim_timeout_refund are
 * permissionless on the contract (anyone may call them once their
 * respective condition is met) — this loop is just "anyone" running on a
 * schedule, not a privileged actor. Uses the same backend-owned wallet
 * previously dedicated to the now-removed heartbeat() call.
 */
export function startDeadlineWatcher(logger: FastifyBaseLogger): void {
  if (!config.genlayer.heartbeatPrivateKey) {
    logger.warn("HEARTBEAT_PRIVATE_KEY not set — bounties will only evaluate/settle when a user clicks the buttons");
    return;
  }
  if (!config.genlayer.contractAddress) {
    logger.warn("GENLAYER_CONTRACT_ADDRESS not set — deadline watcher not started");
    return;
  }

  const account = createAccount(config.genlayer.heartbeatPrivateKey as `0x${string}`);
  const client = createClient({
    chain: studionet,
    endpoint: config.genlayer.rpcUrl || undefined,
    account,
  });

  async function callAndSync(functionName: string, chainBountyId: string, dbBountyId: string) {
    const hash = await client.writeContract({
      address: config.genlayer.contractAddress as `0x${string}`,
      functionName,
      args: [chainBountyId],
      value: 0n,
    });
    await client.waitForTransactionReceipt({ hash, status: "ACCEPTED" as never, interval: 10_000, retries: 30 });
    await syncBountyEvaluation(dbBountyId);
    logger.info({ functionName, chainBountyId, hash }, "deadline-watcher: closed out bounty");
  }

  async function tick() {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const { rows: bounties } = await pool.query(
      `select id, chain_bounty_id from bounties
       where status in ('open', 'evaluating')
         and chain_bounty_id is not null
         and contract_address = $1`,
      [config.genlayer.contractAddress],
    );

    for (const bounty of bounties) {
      try {
        const chain = await readContractView<ChainBounty>("get_bounty", [bounty.chain_bounty_id]);

        if (chain.status === "OPEN" && chain.testimony_count > 0 && nowSeconds > chain.submission_deadline_ts) {
          await callAndSync("evaluate_bounty", bounty.chain_bounty_id, bounty.id);
          continue;
        }
        if (chain.status === "EVALUATED" && chain.verdict && chain.verdict !== "NEEDS_HUMAN_REVIEW") {
          await callAndSync("settle", bounty.chain_bounty_id, bounty.id);
          continue;
        }
        if (
          ["OPEN", "EVALUATING", "EVALUATED"].includes(chain.status) &&
          nowSeconds > chain.evaluation_timeout_ts
        ) {
          await callAndSync("claim_timeout_refund", bounty.chain_bounty_id, bounty.id);
        }
      } catch (err) {
        // One bounty's failure (rate limit, transient RPC error, a
        // NEEDS_HUMAN_REVIEW verdict that genuinely can't auto-settle)
        // must never stop the loop from checking the rest.
        logger.warn({ err, bountyId: bounty.id }, "deadline-watcher: skipping bounty this tick");
      }
    }
  }

  logger.info({ intervalMs: POLL_INTERVAL_MS, address: account.address }, "deadline-watcher: starting");
  void tick();
  setInterval(() => void tick(), POLL_INTERVAL_MS);
}
