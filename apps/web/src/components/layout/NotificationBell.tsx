"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/useAuth";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";

interface Notification {
  id: string;
  kind: string;
  payload: { bountyId?: string; bountyTitle?: string; verdict?: string };
  read_at: string | null;
  created_at: string;
}

const KIND_LABELS: Record<string, string> = {
  testimony_submitted: "New testimony on your bounty",
  bounty_resolved: "A bounty you're involved in resolved",
  evaluation_started: "Evaluation started",
};

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    const poll = () =>
      api
        .get<{ count: number }>("/notifications/unread-count")
        .then((d) => setUnread(d.count))
        .catch(() => undefined);
    poll();
    // Simple poll rather than a websocket/SSE connection — notifications
    // here are informational, not latency-sensitive, so a 30s interval is
    // plenty and keeps the always-on backend's connection count flat.
    const interval = setInterval(poll, 30_000);
    return () => clearInterval(interval);
  }, [user]);

  async function handleOpen() {
    setOpen((o) => !o);
    if (!items && user) {
      const d = await api.get<{ notifications: Notification[] }>("/notifications");
      setItems(d.notifications);
    }
  }

  async function markAllRead() {
    await api.post("/notifications/read-all");
    setUnread(0);
    setItems((list) => list?.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) ?? null);
  }

  if (!user) return null;

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        aria-label="Notifications"
        className="relative p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded transition-colors"
      >
        🔔
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-error" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-surface-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between p-3 border-b border-border-subtle">
            <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">
              Notifications
            </span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-primary text-[10px] font-mono">
                Mark all read
              </button>
            )}
          </div>
          {items === null && <p className="p-4 text-text-secondary text-sm">Loading…</p>}
          {items?.length === 0 && <p className="p-4 text-text-secondary text-sm">No notifications yet.</p>}
          {items?.map((n) => (
            <Link
              key={n.id}
              href={n.payload.bountyId ? `/bounties/${n.payload.bountyId}` : "#"}
              onClick={() => setOpen(false)}
              className={`block p-3 border-b border-border-subtle/50 last:border-0 hover:bg-surface-container-high transition-colors ${n.read_at ? "opacity-60" : ""}`}
            >
              <span className="block text-sm text-on-surface">{KIND_LABELS[n.kind] ?? n.kind}</span>
              {n.payload.bountyTitle && (
                <span className="block text-xs text-text-secondary truncate">{n.payload.bountyTitle}</span>
              )}
              <span className="block font-mono text-[10px] text-text-secondary mt-1">{timeAgo(n.created_at)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
