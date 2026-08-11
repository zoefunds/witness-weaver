import type { FastifyInstance } from "fastify";
import { pool } from "../lib/db.js";

// Reputation is an append-only ledger of signed bps deltas, never a mutable
// counter — this makes the score auditable and hard to silently game.
// Current score = 5000 (neutral midpoint, out of 10000) + sum(deltas),
// clamped to [0, 10000]. Recency-weighting (decay) is applied at read time
// rather than by mutating historical rows.
const BASE_SCORE_BPS = 5000;
const DECAY_HALF_LIFE_DAYS = 180;

function decayWeight(createdAt: Date): number {
  const ageDays = (Date.now() - createdAt.getTime()) / 86_400_000;
  return Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS);
}

export async function reputationRoutes(app: FastifyInstance) {
  app.get("/users/:id/reputation", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query(
      "select delta_bps, created_at, event_type from reputation_events where user_id = $1 order by created_at asc",
      [id],
    );

    let score = BASE_SCORE_BPS;
    for (const row of rows) {
      score += row.delta_bps * decayWeight(new Date(row.created_at));
    }
    score = Math.max(0, Math.min(10000, Math.round(score)));

    return reply.send({
      userId: id,
      scoreBps: score,
      eventCount: rows.length,
      events: rows,
    });
  });

  // Called internally once an evaluation confirms with a verdict — never
  // exposed as a raw "add reputation" endpoint a client could call directly.
  app.post("/internal/reputation-events", { preHandler: requireInternalCaller }, async (req, reply) => {
    const body = req.body as {
      userId: string;
      bountyId?: string;
      eventType: string;
      deltaBps: number;
      note?: string;
    };
    const { rows } = await pool.query(
      `insert into reputation_events (user_id, bounty_id, event_type, delta_bps, note)
       values ($1,$2,$3,$4,$5) returning *`,
      [body.userId, body.bountyId ?? null, body.eventType, body.deltaBps, body.note ?? null],
    );
    return reply.code(201).send({ event: rows[0] });
  });
}

// Placeholder gate for the internal reputation-write endpoint: in production
// this route should only be reachable from the evaluation-sync flow itself
// (e.g. shared-secret header set by the trusted internal caller), never from
// the public internet. Wired here so the boundary is explicit in code.
function requireInternalCaller(req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply, done: () => void) {
  const secret = req.headers["x-internal-secret"];
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    reply.code(403).send({ error: "forbidden" });
    return;
  }
  done();
}
