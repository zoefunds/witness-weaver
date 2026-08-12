import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { config } from "../lib/config.js";

function isCloudinaryConfigured(): boolean {
  return Boolean(config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret);
}

/**
 * Evidence file upload via Cloudinary's signed-upload flow: the browser
 * uploads directly to Cloudinary (never through our API server, so a large
 * video doesn't tie up the always-on Fastify process), using a signature
 * this endpoint generates server-side with our API secret. The secret
 * itself never reaches the client — only a timestamp + signature valid for
 * that one upload.
 *
 * Cloudinary's signature scheme: take every parameter EXCEPT file/api_key/
 * signature/resource_type, sort them alphabetically by key, join as
 * "key=value&key=value...", append the API secret directly (no separator),
 * then SHA-1 hex-digest the result. https://cloudinary.com/documentation/signatures
 */
export async function uploadRoutes(app: FastifyInstance) {
  app.post("/uploads/presign", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    if (!isCloudinaryConfigured()) {
      return reply.code(503).send({ error: "storage_not_configured" });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    // Folder-per-user keeps evidence traceable to its uploader without a
    // separate mapping table, same reasoning as the R2 key scheme this
    // replaced.
    const folder = `witnessweave/${req.session.userId}`;

    const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
    const signature = createHash("sha1").update(paramsToSign + config.cloudinary.apiSecret).digest("hex");

    return reply.send({
      uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudinary.cloudName}/auto/upload`,
      apiKey: config.cloudinary.apiKey,
      timestamp,
      signature,
      folder,
    });
  });
}
