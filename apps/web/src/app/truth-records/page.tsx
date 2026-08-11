import Link from "next/link";
import { TopNav } from "@/components/layout/TopNav";
import { SideNav } from "@/components/layout/SideNav";
import { Footer } from "@/components/layout/Footer";
import { StatusChip } from "@/components/ui/StatusChip";
import { formatBps, timeAgo } from "@/lib/format";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

interface RecordSummary {
  id: string;
  title: string;
  incident_type: string;
  verdict: string;
  confidence_bps: number;
  published_at: string;
}

async function getRecords(): Promise<{ records: RecordSummary[]; reachable: boolean }> {
  try {
    const res = await fetch(`${API_BASE_URL}/truth-records`, { cache: "no-store" });
    if (!res.ok) return { records: [], reachable: true };
    const data = await res.json();
    return { records: data.truthRecords ?? [], reachable: true };
  } catch {
    return { records: [], reachable: false };
  }
}

export default async function TruthRecordsIndexPage() {
  const { records, reachable } = await getRecords();

  return (
    <>
      <TopNav active="/truth-records" />
      <div className="flex flex-1 w-full max-w-[1280px] mx-auto">
        <SideNav active="/truth-records" />
        <main className="flex-1 p-4 md:p-12">
          <header className="mb-8 border-b border-border-subtle pb-6">
            <h1 className="text-3xl font-semibold text-text-primary mb-2">Truth Record Archive</h1>
            <p className="text-text-secondary max-w-xl">
              Every finalized bounty outcome, permanently published with its verdict, confidence, and
              settlement transaction.
            </p>
          </header>

          {!reachable && (
            <div className="bg-error-container/20 border border-error/30 text-error rounded-lg p-4 text-sm">
              Couldn&apos;t reach the WitnessWeave API.
            </div>
          )}

          {reachable && records.length === 0 && (
            <div className="border border-dashed border-border-subtle rounded-lg p-16 flex flex-col items-center text-center gap-3">
              <span className="text-4xl">📚</span>
              <h2 className="text-lg font-medium text-text-primary">No Truth Records yet</h2>
              <p className="text-text-secondary max-w-sm">
                Records appear here once a bounty evaluation reaches confirmed on-chain consensus.
              </p>
            </div>
          )}

          {records.length > 0 && (
            <div className="flex flex-col gap-3">
              {records.map((r) => (
                <Link
                  key={r.id}
                  href={`/truth-records/${r.id}`}
                  className="flex items-center justify-between gap-4 bg-surface-elevated border border-border-subtle rounded-lg p-4 hover:border-outline transition-colors"
                >
                  <div className="min-w-0">
                    <span className="font-mono text-[10px] text-text-secondary uppercase tracking-wider">
                      {r.incident_type}
                    </span>
                    <h3 className="text-text-primary font-medium truncate">{r.title}</h3>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="font-mono text-xs text-text-secondary">{formatBps(r.confidence_bps)}</span>
                    <StatusChip status={r.verdict} />
                    <span className="font-mono text-[10px] text-text-secondary hidden md:inline">
                      {timeAgo(r.published_at)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </main>
      </div>
      <Footer />
    </>
  );
}
