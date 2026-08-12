"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TopNav } from "@/components/layout/TopNav";
import { SideNav } from "@/components/layout/SideNav";
import { Footer } from "@/components/layout/Footer";
import { StatusChip } from "@/components/ui/StatusChip";
import { ClaimBondRefundButton } from "@/components/bounty/ClaimBondRefundButton";
import { useAuth } from "@/lib/useAuth";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";

interface MyTestimony {
  id: string;
  bounty_id: string;
  statement: string;
  status: string;
  created_at: string;
  chain_testimony_id: string | null;
  bond_deposited_wei: string;
  bond_claimed: boolean;
}

export default function MyTestimoniesPage() {
  const { user } = useAuth();
  const [testimonies, setTestimonies] = useState<MyTestimony[] | null>(null);

  const load = useCallback(() => {
    if (!user) return;
    api
      .get<{ testimonies: MyTestimony[] }>(`/users/${user.id}/testimonies`)
      .then((d) => setTestimonies(d.testimonies))
      .catch(() => setTestimonies([]));
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <TopNav active="/dashboard/testimonies" />
      <div className="flex flex-1 w-full max-w-[1280px] mx-auto">
        <SideNav />
        <main className="flex-1 p-4 md:p-12">
          <header className="mb-8 border-b border-border-subtle pb-6">
            <h1 className="text-3xl font-semibold text-text-primary mb-2">My Testimonies</h1>
            <p className="text-text-secondary">Testimony you've submitted across all bounties.</p>
          </header>

          {!user && <p className="text-text-secondary">Sign in to view your testimony history.</p>}

          {user && testimonies === null && <p className="text-text-secondary">Loading…</p>}

          {user && testimonies?.length === 0 && (
            <div className="border border-dashed border-border-subtle rounded-lg p-16 flex flex-col items-center text-center gap-3">
              <span className="text-4xl">📝</span>
              <h2 className="text-lg font-medium text-text-primary">No testimony submitted yet</h2>
              <Link href="/discover" className="text-primary text-sm mt-1">
                Browse open bounties →
              </Link>
            </div>
          )}

          {testimonies && testimonies.length > 0 && (
            <div className="flex flex-col gap-3">
              {testimonies.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-4 bg-surface-elevated border border-border-subtle rounded-lg p-4 hover:border-outline transition-colors"
                >
                  <Link href={`/bounties/${t.bounty_id}`} className="text-sm text-on-surface-variant truncate flex-1">
                    {t.statement}
                  </Link>
                  <div className="flex items-center gap-3 shrink-0">
                    <ClaimBondRefundButton testimony={t} onClaimed={load} />
                    <StatusChip status={t.status} />
                    <span className="font-mono text-[10px] text-text-secondary">{timeAgo(t.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
      <Footer />
    </>
  );
}
