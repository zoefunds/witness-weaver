import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { notify } from "../lib/notify.js";

const EvidenceRefSchema = z.object({
  kind: z.enum(["image", "document", "video", "url"]),
  url: z.string().url(),
  fileHash: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

const SubmitTestimonySchema = z.object({
  bountyId: z.string().uuid(),
  statement: z.string().min(20).max(8000),
  occurredAt: z.string().datetime().optional(),
  locationContext: z.string().max(500).optional(),
  isAnonymous: z.boolean().default(false),
  bondWei: z.string().regex(/^\d+$/).default("0"),
  evidence: z.array(EvidenceRefSchema).max(10).default([]),
});

const TxSyncSchema = z.object({
  chainTestimonyId: z.string().optional(),
  submitTxHash: z.string().optional(),
  bondDepositedWei: z.string().regex(/^\d+$/).optional(),
});

export async function testimonyRoutes(app: FastifyInstance) {
  app.post("/testimonies", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    const parsed = SubmitTestimonySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_payload", details: parsed.error.flatten() });
    const t = parsed.data;

    const { rows: bountyRows } = await pool.query(
      "select status, creator_id, title from bounties where id = $1",
      [t.bountyId],
    );
    if (!bountyRows[0]) return reply.code(404).send({ error: "bounty_not_found" });
    const bounty = bountyRows[0];
    if (!["open", "evaluating"].includes(bounty.status)) {
      return reply.code(409).send({ error: "bounty_not_accepting_testimony" });
    }

    // Baseline Sybil friction: one testimony per wallet per bounty. This
    // doesn't stop someone rotating wallets, but it does stop the trivial
    // case of one account spamming a bounty with many "independent"
    // accounts to skew corroboration.
    const { rows: existing } = await pool.query(
      "select id from testimonies where bounty_id = $1 and submitter_id = $2",
      [t.bountyId, req.session.userId],
    );
    if (existing[0]) {
      return reply.code(409).send({ error: "already_submitted", testimonyId: existing[0].id });
    }

    // The full statement text stays off-chain (privacy + gas cost); only its
    // hash is anchored on-chain by the frontend's submit_testimony tx, so the
    // contract's evaluation prompt can reference this exact hash to prove the
    // text used for judgment wasn't altered after the fact.
    const statementHash = createHash("sha256").update(t.statement, "utf8").digest("hex");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `insert into testimonies
          (bounty_id, submitter_id, statement, statement_hash, occurred_at, location_context, is_anonymous, bond_wei)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning *`,
        [
          t.bountyId,
          req.session.userId,
          t.statement,
          statementHash,
          t.occurredAt ?? null,
          t.locationContext ?? null,
          t.isAnonymous,
          t.bondWei,
        ],
      );
      const testimony = rows[0];

      for (const ev of t.evidence) {
        await client.query(
          `insert into evidence_files (testimony_id, kind, url, file_hash, mime_type, size_bytes)
           values ($1,$2,$3,$4,$5,$6)`,
          [testimony.id, ev.kind, ev.url, ev.fileHash ?? null, ev.mimeType ?? null, ev.sizeBytes ?? null],
        );
      }
      await client.query("COMMIT");

      if (bounty.creator_id !== req.session.userId) {
        await notify(bounty.creator_id, "testimony_submitted", {
          bountyId: t.bountyId,
          bountyTitle: bounty.title,
          testimonyId: testimony.id,
        });
      }

      return reply.code(201).send({ testimony, statementHash });
    } catch (err) {
      await client.query("ROLLBACK");
      // Belt-and-suspenders: the pre-check above has a race window under
      // concurrent requests from the same user, closed by the DB's own
      // unique constraint (23505 = unique_violation).
      if (err && typeof err === "object" && "code" in err && err.code === "23505") {
        return reply.code(409).send({ error: "already_submitted" });
      }
      throw err;
    } finally {
      client.release();
    }
  });

  app.patch("/testimonies/:id/chain-sync", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    const parsed = TxSyncSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_payload" });

    const { rows: owned } = await pool.query("select submitter_id from testimonies where id = $1", [
      (req.params as { id: string }).id,
    ]);
    if (!owned[0]) return reply.code(404).send({ error: "testimony_not_found" });
    if (owned[0].submitter_id !== req.session.userId) return reply.code(403).send({ error: "not_owner" });

    const s = parsed.data;
    const { rows } = await pool.query(
      `update testimonies set
         chain_testimony_id = coalesce($2, chain_testimony_id),
         submit_tx_hash = coalesce($3, submit_tx_hash),
         bond_deposited_wei = coalesce($4, bond_deposited_wei)
       where id = $1
       returning *`,
      [(req.params as { id: string }).id, s.chainTestimonyId, s.submitTxHash, s.bondDepositedWei],
    );
    return reply.send({ testimony: rows[0] });
  });

  app.get("/users/:userId/testimonies", async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: "authentication_required" });
    const { userId } = req.params as { userId: string };
    if (req.session.userId !== userId) return reply.code(403).send({ error: "forbidden" });
    const { rows } = await pool.query(
      "select * from testimonies where submitter_id = $1 order by created_at desc",
      [userId],
    );
    return reply.send({ testimonies: rows });
  });

  app.get("/bounties/:bountyId/testimonies", async (req, reply) => {
    const { bountyId } = req.params as { bountyId: string };
    const { rows: testimonies } = await pool.query(
      "select * from testimonies where bounty_id = $1 order by created_at asc",
      [bountyId],
    );
    const ids = testimonies.map((t) => t.id);
    const { rows: evidence } =
      ids.length > 0
        ? await pool.query("select * from evidence_files where testimony_id = any($1::uuid[])", [ids])
        : { rows: [] as unknown[] };

    const byTestimony = new Map<string, unknown[]>();
    for (const e of evidence as { testimony_id: string }[]) {
      const list = byTestimony.get(e.testimony_id) ?? [];
      list.push(e);
      byTestimony.set(e.testimony_id, list);
    }
    return reply.send({
      testimonies: testimonies.map((t) => ({ ...t, evidence: byTestimony.get(t.id) ?? [] })),
    });
  });
}
