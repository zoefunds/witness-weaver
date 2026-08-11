import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
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
  });
  await app.register(cookie);
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
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
