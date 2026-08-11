import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { FastifyBaseLogger } from "fastify";
import { config } from "./config.js";

/**
 * GenVM contract code has no trusted wall-clock timestamp, so
 * WitnessWeaveContract measures submission windows and evaluation timeouts
 * with a virtual epoch counter that only advances when someone calls its
 * permissionless heartbeat() write method. Without something calling that
 * periodically, every bounty's "deadline" never actually arrives.
 *
 * This runs a plain interval inside the always-on API process (Fly.io
 * keeps at least one machine running per fly.toml) using a dedicated
 * backend-owned wallet — never a user's wallet, and never touching escrow
 * funds, since heartbeat() is a non-payable write with no side effects
 * beyond incrementing the counter.
 */
export function startHeartbeatLoop(logger: FastifyBaseLogger): void {
  if (!config.genlayer.heartbeatPrivateKey) {
    logger.warn("HEARTBEAT_PRIVATE_KEY not set — the contract's virtual epoch clock will never advance");
    return;
  }
  if (!config.genlayer.contractAddress) {
    logger.warn("GENLAYER_CONTRACT_ADDRESS not set — heartbeat loop not started");
    return;
  }

  const account = createAccount(config.genlayer.heartbeatPrivateKey as `0x${string}`);
  const client = createClient({
    chain: studionet,
    endpoint: config.genlayer.rpcUrl || undefined,
    account,
  });

  const tick = async () => {
    try {
      const hash = await client.writeContract({
        address: config.genlayer.contractAddress as `0x${string}`,
        functionName: "heartbeat",
        args: [],
        value: 0n,
      });
      logger.info({ hash }, "heartbeat: advanced contract epoch");
    } catch (err) {
      // Never let a single failed heartbeat (rate limit, transient RPC
      // error) crash the always-on API process — just log and retry next
      // interval.
      logger.warn({ err }, "heartbeat: call failed, will retry next interval");
    }
  };

  logger.info(
    { address: account.address, intervalMs: config.genlayer.heartbeatIntervalMs },
    "heartbeat: starting virtual epoch clock loop",
  );
  void tick();
  setInterval(tick, config.genlayer.heartbeatIntervalMs);
}
