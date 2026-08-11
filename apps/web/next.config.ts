import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // WalletConnect/Reown's Coinbase Smart Wallet connector pulls in
  // @coinbase/cdp-sdk, which dynamically imports optional Solana x402
  // sub-packages we don't ship (WitnessWeave only targets GenLayer's
  // EVM-compatible StudioNet). Webpack tries to statically resolve those
  // dynamic imports during SSR bundling and fails; they're never actually
  // reached at runtime, so it's safe to tell webpack to treat them as
  // externals instead of bundling them.
  webpack: (config) => {
    const existing = Array.isArray(config.externals) ? config.externals : [];
    config.externals = [
      ...existing,
      "pino-pretty",
      ({ request }: { request?: string }, callback: (err?: null, result?: string) => void) => {
        // @wagmi/core ships an experimental "tempo" chain export with a
        // broken bare-specifier import ("accounts") that isn't a real
        // dependency; unreachable in our app (we never import wagmi/tempo).
        if (request && (request.startsWith("@x402/") || request === "accounts")) {
          return callback(null, `commonjs ${request}`);
        }
        callback();
      },
    ];
    return config;
  },
};

export default nextConfig;
