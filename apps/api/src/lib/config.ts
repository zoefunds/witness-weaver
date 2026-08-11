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
  genlayer: {
    rpcUrl: process.env.GENLAYER_RPC_URL ?? "",
    contractAddress: process.env.GENLAYER_CONTRACT_ADDRESS ?? "",
    // A dedicated, backend-owned wallet used ONLY to call the contract's
    // permissionless heartbeat() — GenVM contract code has no trusted
    // timestamp, so the contract's submission-window/evaluation-timeout
    // logic runs on a virtual epoch counter that only advances when
    // someone calls heartbeat(). This wallet needs a small GEN balance on
    // StudioNet to cover gas; it never touches bounty funds.
    heartbeatPrivateKey: process.env.HEARTBEAT_PRIVATE_KEY ?? "",
    heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS ?? 120_000),
  },
  storage: {
    endpoint: process.env.STORAGE_ENDPOINT ?? "",
    bucket: process.env.STORAGE_BUCKET ?? "witnessweave-evidence",
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? "",
    publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL ?? "",
  },
};
