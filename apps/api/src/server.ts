import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { config } from "./lib/config.js";
import { attachAuthContext } from "./plugins/auth-plugin.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { bountyRoutes } from "./routes/bounties.js";
import { testimonyRoutes } from "./routes/testimonies.js";
import { evaluationRoutes } from "./routes/evaluations.js";
import { truthRecordRoutes } from "./routes/truth-records.js";
import { reputationRoutes } from "./routes/reputation.js";
import { txStatusRoutes } from "./routes/tx-status.js";
import { rpcProxyRoutes } from "./routes/rpc-proxy.js";
import { evaluationSyncRoutes } from "./routes/evaluation-sync.js";
import { startHeartbeatLoop } from "./lib/heartbeat.js";

async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport: config.env === "development" ? { target: "pino-pretty" } : undefined,
    },
    trustProxy: true, // required behind Fly.io's edge proxy for correct client IPs
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    // @fastify/cors defaults `methods` to just "GET,HEAD,POST" — every
    // PATCH route in this API (chain-sync for bounties/testimonies/
    // evaluations) was being silently blocked by the browser's CORS
    // preflight as a result, so a confirmed on-chain transaction never
    // made it back into the database. DELETE isn't used anywhere yet but
    // is included for forward-compatibility with routes.
    methods: ["GET", "POST", "PATCH", "DELETE"],
  });
  await app.register(cookie);
  // Baseline abuse/spam protection: a per-IP ceiling on request volume.
  // Deliberately generous — this is a backstop against runaway scripts and
  // basic spam, not fine-grained per-endpoint policy (bounty/testimony
  // creation still relies on wallet-signature auth as the real Sybil
  // resistance, since a rate limit alone doesn't stop a determined attacker
  // rotating wallets).
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
  });
  // Called directly (not via app.register) so the session decorator/hook
  // apply to the whole app, not just an isolated plugin context — see
  // attachAuthContext's own comment for why that distinction matters.
  attachAuthContext(app);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(bountyRoutes);
  await app.register(testimonyRoutes);
  await app.register(evaluationRoutes);
  await app.register(truthRecordRoutes);
  await app.register(reputationRoutes);
  await app.register(txStatusRoutes);
  await app.register(rpcProxyRoutes);
  await app.register(evaluationSyncRoutes);

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    app.log.error(err);
    const status = err.statusCode ?? 500;
    reply.code(status).send({
      error: status === 500 ? "internal_server_error" : err.message,
    });
  });

  return app;
}

async function main() {
  const app = await buildServer();

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down gracefully`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    startHeartbeatLoop(app.log);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
