import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: required("DATABASE_URL"),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  sessionJwtSecret: required("SESSION_JWT_SECRET", "dev-only-insecure-secret-change-me"),
  // Optional. When set, rate limiting is shared across all Fly.io machines
  // via Redis instead of each machine tracking its own in-memory count —
  // without this, running N machines silently multiplies the real ceiling
  // by N, since @fastify/rate-limit defaults to per-process state.
  redisUrl: process.env.REDIS_URL ?? "",
  genlayer: {
    rpcUrl: process.env.GENLAYER_RPC_URL ?? "",
    contractAddress: process.env.GENLAYER_CONTRACT_ADDRESS ?? "",
    // A dedicated, backend-owned wallet used ONLY by the deadline watcher
    // (lib/deadline-watcher.ts) to call the contract's permissionless
    // evaluate_bounty/settle/claim_timeout_refund once their respective
    // deadline has genuinely passed — closing out bounties nobody's
    // actively watching in a browser. Contract deadlines are real
    // wall-clock timestamps (GenVM patches datetime.now() to a
    // consensus-agreed block time), not an invented clock this wallet
    // has to advance itself. Needs a small GEN balance on StudioNet to
    // cover gas; it never touches bounty funds.
    heartbeatPrivateKey: process.env.HEARTBEAT_PRIVATE_KEY ?? "",
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
    apiKey: process.env.CLOUDINARY_API_KEY ?? "",
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  },
};
