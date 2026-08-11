import type { FastifyInstance } from "fastify";
import { config } from "../lib/config.js";

/**
 * GenLayer StudioNet's RPC endpoint (studio.genlayer.com/api) doesn't send
 * CORS headers for arbitrary browser origins — genlayer-js's read calls
 * (eth_getTransactionCount, eth_getBalance, eth_gasPrice, etc.) fail with a
 * browser CORS error when called directly from the frontend, even though
 * the wallet-signing calls (which go through the connected wallet's own
 * EIP-1193 provider, not this endpoint) work fine. This route re-exposes
 * the same JSON-RPC endpoint from our own domain: server-to-server HTTP
 * calls aren't subject to CORS at all, and our CORS config already permits
 * the frontend origin to call this API. The frontend points
 * NEXT_PUBLIC_GENLAYER_RPC_URL at this route instead of calling GenLayer
 * directly.
 */
export async function rpcProxyRoutes(app: FastifyInstance) {
  app.post("/rpc/genlayer", async (req, reply) => {
    if (!config.genlayer.rpcUrl) {
      return reply.code(503).send({ error: "genlayer_rpc_not_configured" });
    }
    try {
      const upstream = await fetch(config.genlayer.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const body = await upstream.text();
      reply.code(upstream.status).header("Content-Type", "application/json").send(body);
    } catch (err) {
      app.log.error(err, "GenLayer RPC proxy request failed");
      return reply.code(502).send({ error: "genlayer_rpc_unreachable" });
    }
  });
}
