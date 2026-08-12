import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { Address } from "genlayer-js/types";

export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS ?? "") as Address;

export function isContractConfigured(): boolean {
  return CONTRACT_ADDRESS.length === 42 && CONTRACT_ADDRESS.startsWith("0x");
}

// StudioNet's own RPC endpoint (studio.genlayer.com/api) doesn't send CORS
// headers for browser origins — direct calls from the frontend fail with
// "blocked by CORS policy" on every read call genlayer-js makes internally
// (eth_getTransactionCount for the nonce, eth_getBalance, eth_gasPrice,
// etc.), even though wallet-signing itself goes through the connected
// wallet's own provider and isn't affected. We route those calls through
// our own backend instead (apps/api's /rpc/genlayer), which forwards them
// server-to-server — not subject to browser CORS at all.
const RPC_ENDPOINT = `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080"}/rpc/genlayer`;

/** Read-only client — no wallet required, safe to use in any component. */
export function getReadClient() {
  return createClient({ chain: studionet, endpoint: RPC_ENDPOINT });
}

/**
 * Write client bound to the connected wallet's EIP-1193 provider (obtained
 * via Reown AppKit's useAppKitProvider, which works for both injected
 * wallets like MetaMask and WalletConnect-relayed wallets like Rainbow /
 * Zerion). Every state-changing call (create_bounty, submit_testimony,
 * evaluate_bounty, settle, ...) is signed by the user's own wallet — the
 * frontend/backend never holds or uses a private key. Read-side RPC calls
 * (nonce, gas price, receipts) still go through our backend proxy above,
 * only the actual transaction signing/sending uses the wallet's provider.
 *
 * `account` is passed as a PLAIN STRING here, not a wrapped object — this
 * matters more than it looks. genlayer-js's internal transport keeps a
 * flag (`isAddress = typeof config.account !== "object"`) that decides
 * whether wallet-signing methods like eth_sendTransaction get routed to
 * the injected wallet provider at all; wrapping the account in an object
 * flips that flag and silently routes signing calls to the plain RPC
 * endpoint instead (which can't sign anything, producing "Method not
 * found: eth_sendTransaction"). Internally, genlayer-js/viem still
 * normalizes this string into a proper `{ address, type: 'json-rpc' }`
 * account object wherever one is actually needed (e.g. building calldata)
 * — passing a bare string here is the form the SDK expects, confirmed
 * against a working sibling GenLayer dApp's wallet integration.
 */
export function getWriteClient(provider: unknown, address: Address) {
  return createClient({
    chain: studionet,
    endpoint: RPC_ENDPOINT,
    account: address,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- genlayer-js expects an EIP-1193 provider; AppKit's provider type isn't re-exported cleanly
    provider: provider as any,
  });
}

interface ChainBounty {
  bounty_id: string;
  creator: string;
  title: string;
}

/**
 * create_bounty returns the contract's own sequential bounty id as its
 * function return value, but pulling that out of a GenVM transaction
 * receipt means parsing consensus/leader-receipt internals that aren't a
 * stable public shape (and vary by SDK version). Since ids are assigned as
 * a simple incrementing "bounty:{n}" sequence, the newly created bounty is
 * reliably the most recent one whose creator + title match what was just
 * submitted — scanning back a few entries from the current total handles
 * the (rare, testing-scale) case where another creation lands in between.
 */
async function readJsonView<T>(client: ReturnType<typeof createClient>, functionName: string, args: unknown[]): Promise<T> {
  // GenVM view methods return JSON-encoded strings, not parsed objects —
  // the SDK doesn't decode this automatically.
  const raw = await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: args as any,
  });
  return typeof raw === "string" ? (JSON.parse(raw) as T) : (raw as T);
}

export async function resolveChainBountyId(creatorAddress: Address, title: string): Promise<string | null> {
  const client = getReadClient();
  const info = await readJsonView<{ total_bounties: number }>(client, "get_contract_info", []);
  const total = info.total_bounties;
  for (let i = total - 1; i >= Math.max(0, total - 5); i--) {
    const bounty = await readJsonView<ChainBounty>(client, "get_bounty", [`bounty:${i}`]);
    if (bounty.creator?.toLowerCase() === creatorAddress.toLowerCase() && bounty.title === title) {
      return bounty.bounty_id;
    }
  }
  return null;
}
