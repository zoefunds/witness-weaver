import { defineChain } from "viem";

// GenLayer StudioNet — chain id per official GenLayer docs
// (https://docs.genlayer.com/). Fees are paid in GEN, GenLayer's native
// token. RPC calls are routed through our own backend proxy
// (/rpc/genlayer) rather than studio.genlayer.com/api directly — that
// endpoint doesn't send CORS headers for browser origins, so wagmi/AppKit's
// own RPC calls (balance lookups, etc.) fail with a CORS error if pointed
// at it directly from the frontend.
const RPC_ENDPOINT = `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080"}/rpc/genlayer`;

export const genlayerStudionet = defineChain({
  id: 61_999,
  name: "GenLayer Studionet",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_ENDPOINT] },
  },
  blockExplorers: {
    default: { name: "GenLayer Studio", url: "https://studio.genlayer.com" },
  },
  testnet: true,
});
