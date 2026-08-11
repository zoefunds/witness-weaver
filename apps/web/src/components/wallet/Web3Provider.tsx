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
    features: { analytics: false, email: false, socials: false },
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
