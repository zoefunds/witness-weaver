import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { config } from "./config.js";

/**
 * Read-only GenLayer StudioNet client used by the backend to mirror on-chain
 * bounty/evaluation/truth-record state into Postgres for fast reads, and to
 * poll transaction receipts for the tx_status_log lifecycle tracker.
 *
 * The backend never signs or submits state-changing transactions on the
 * user's behalf — every write (create_bounty, submit_testimony, settle, ...)
 * is signed client-side by the user's connected wallet. This client only
 * calls read/view methods and reads transaction receipts.
 */
let client: ReturnType<typeof createClient> | null = null;

export function getGenlayerClient() {
  if (!config.genlayer.contractAddress) {
    throw new Error("GENLAYER_CONTRACT_ADDRESS is not configured yet — deploy the contract first.");
  }
  if (!client) {
    client = createClient({
      chain: studionet,
      endpoint: config.genlayer.rpcUrl || undefined,
    });
  }
  return client;
}

export async function readContractView<T = unknown>(functionName: string, args: unknown[] = []): Promise<T> {
  const gl = getGenlayerClient();
  const raw = await gl.readContract({
    address: config.genlayer.contractAddress as `0x${string}`,
    functionName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK's CalldataEncodable union is narrower than our generic route params
    args: args as any,
  });
  // Contract view methods return JSON-encoded strings (GenVM view return-type
  // constraint) — decode here so callers work with plain objects.
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }
  return raw as T;
}

export async function getTransactionStatus(txHash: string) {
  const gl = getGenlayerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK's Hash type is a fixed-length branded string; runtime value is always well-formed
  return gl.getTransaction({ hash: txHash as any });
}
