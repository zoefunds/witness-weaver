"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { createAppKit } from "@reown/appkit/react";
import { networks, reownProjectId, wagmiAdapter, wagmiConfig } from "@/lib/wagmi-config";
import { genlayerStudionet } from "@/lib/chains";

let appKitInitialized = false;

function ensureAppKit() {
  if (appKitInitialized) return;
  appKitInitialized = true;
  createAppKit({
    adapters: [wagmiAdapter],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- appkit's tuple type wants a mutable non-empty array; `networks` is a single-chain readonly tuple
    networks: networks as any,
    defaultNetwork: genlayerStudionet,
    projectId: reownProjectId,
    metadata: {
      name: "WitnessWeave",
      description: "Turn real-world testimony into a living truth layer.",
      url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://witnessweave.app",
      icons: ["/icon"],
    },
    themeMode: "dark",
    themeVariables: {
      "--w3m-accent": "#4f46e5",
      "--w3m-border-radius-master": "2px",
    },
    // AppKit's account button fetches portfolio/balance/swap-quote/activity
    // data from Reown's own remote data API for these features by default.
    // That API doesn't know about GenLayer's custom StudioNet chain (id
    // 61999), so those requests never resolve — which is what shows up as
    // the account button's spinner never stopping. None of these features
    // are used by WitnessWeave, so they're switched off rather than left to
    // hang.
    features: {
      analytics: false,
      email: false,
      socials: false,
      history: false,
      send: false,
      receive: false,
      swaps: false,
      onramp: false,
    },
  });
}

export function Web3Provider({ children }: { children: ReactNode }) {
  ensureAppKit();
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
