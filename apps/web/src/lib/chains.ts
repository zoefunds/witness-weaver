import { defineChain } from "viem";

// GenLayer StudioNet — chain id and RPC per official GenLayer docs
// (https://docs.genlayer.com/). Fees are paid in GEN, GenLayer's native token.
export const genlayerStudionet = defineChain({
  id: 61_999,
  name: "GenLayer Studionet",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "https://studio.genlayer.com/api"] },
  },
  blockExplorers: {
    default: { name: "GenLayer Studio", url: "https://studio.genlayer.com" },
  },
  testnet: true,
});
