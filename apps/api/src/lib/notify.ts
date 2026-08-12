import { pool } from "./db.js";

export type NotificationKind = "testimony_submitted" | "bounty_resolved" | "evaluation_started";

/**
 * Single write path for every notification the app creates — kept as one
 * function so the payload shape per kind stays consistent instead of each
 * call site inventing its own JSON structure.
 */
export async function notify(userId: string, kind: NotificationKind, payload: Record<string, unknown>) {
  await pool.query("insert into notifications (user_id, kind, payload) values ($1,$2,$3)", [
    userId,
    kind,
    JSON.stringify(payload),
  ]);
}
