"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/layout/TopNav";
import { SideNav } from "@/components/layout/SideNav";
import { Footer } from "@/components/layout/Footer";
import { useAuth } from "@/lib/useAuth";
import { api } from "@/lib/api";
import { formatBps, timeAgo } from "@/lib/format";

interface ReputationData {
  scoreBps: number;
  eventCount: number;
  events: { delta_bps: number; event_type: string; created_at: string }[];
}

export default function ReputationPage() {
  const { user } = useAuth();
  const [data, setData] = useState<ReputationData | null>(null);

  useEffect(() => {
    if (!user) return;
    api.get<ReputationData>(`/users/${user.id}/reputation`).then(setData).catch(() => setData(null));
  }, [user]);

  return (
    <>
      <TopNav active="/dashboard/reputation" />
      <div className="flex flex-1 w-full max-w-[1280px] mx-auto">
        <SideNav active="/dashboard/reputation" />
        <main className="flex-1 p-4 md:p-12">
          <header className="mb-8 border-b border-border-subtle pb-6">
            <h1 className="text-3xl font-semibold text-text-primary mb-2">Reputation</h1>
            <p className="text-text-secondary max-w-xl">
              A recency-weighted, append-only ledger of corroborated and disputed testimony. It cannot be
              bought or manually adjusted — it's derived entirely from evaluation outcomes.
            </p>
          </header>

          {!user && <p className="text-text-secondary">Sign in to view your reputation.</p>}

          {user && data && (
            <div className="flex flex-col gap-6">
              <div className="bg-surface-elevated border border-border-subtle rounded-lg p-8 flex flex-col items-center">
                <span className="font-mono text-[10px] text-text-secondary uppercase tracking-widest mb-3">
                  Current Score
                </span>
                <span className="text-5xl font-bold text-text-primary">{formatBps(data.scoreBps)}</span>
                <span className="font-mono text-xs text-text-secondary mt-2">{data.eventCount} events on record</span>
              </div>

              <div className="bg-surface-elevated border border-border-subtle rounded-lg p-6">
                <h2 className="text-lg font-medium text-text-primary mb-4 border-b border-border-subtle pb-2">
                  Event Ledger
                </h2>
                {data.events.length === 0 ? (
                  <p className="text-text-secondary text-sm">No reputation events yet.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {data.events.map((e, i) => (
                      <li key={i} className="flex items-center justify-between font-mono text-xs py-2 border-b border-border-subtle/50 last:border-0">
                        <span className="text-on-surface-variant">{e.event_type.replace(/_/g, " ")}</span>
                        <span className={e.delta_bps >= 0 ? "text-secondary" : "text-error"}>
                          {e.delta_bps >= 0 ? "+" : ""}
                          {formatBps(e.delta_bps)}
                        </span>
                        <span className="text-text-secondary">{timeAgo(e.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
      <Footer />
    </>
  );
}
