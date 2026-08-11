import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { Address } from "genlayer-js/types";

export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS ?? "") as Address;

export function isContractConfigured(): boolean {
  return CONTRACT_ADDRESS.length === 42 && CONTRACT_ADDRESS.startsWith("0x");
}

/** Read-only client — no wallet required, safe to use in any component. */
export function getReadClient() {
  return createClient({ chain: studionet });
}

/**
 * The account genlayer-js expects here is a viem-style Account object, not
 * a plain address string — confirmed by reading genlayer-js's own source
 * (its internal `_encodeAddTransactionData` does `senderAccount.address`,
 * which is `undefined` on a raw string and produces the cryptic viem error
 * `Address "undefined" is invalid.`). This mirrors viem's own
 * `JsonRpcAccount` shape, the one it uses for injected/browser-wallet
 * accounts (as opposed to a `LocalAccount` holding its own private key).
 */
export function toJsonRpcAccount(address: Address) {
  return { address, type: "json-rpc" as const };
}

/**
 * Write client bound to the connected wallet's EIP-1193 provider (obtained
 * via Reown AppKit's useAppKitProvider, which works for both injected
 * wallets like MetaMask and WalletConnect-relayed wallets like Rainbow /
 * Zerion). Every state-changing call (create_bounty, submit_testimony,
 * evaluate_bounty, settle, ...) is signed by the user's own wallet — the
 * frontend/backend never holds or uses a private key.
 */
export function getWriteClient(provider: unknown, address: Address) {
  return createClient({
    chain: studionet,
    account: toJsonRpcAccount(address),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- genlayer-js expects an EIP-1193 provider; AppKit's provider type isn't re-exported cleanly
    provider: provider as any,
  });
}
