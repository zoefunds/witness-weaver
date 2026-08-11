import { TopNav } from "@/components/layout/TopNav";
import { Footer } from "@/components/layout/Footer";
import { isContractConfigured } from "@/lib/genlayer-client";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

async function getApiHealth() {
  try {
    const res = await fetch(`${API_BASE_URL}/health`, { cache: "no-store" });
    const body = await res.json();
    return { ok: res.ok, ...body };
  } catch {
    return { ok: false, status: "unreachable" };
  }
}

export default async function NetworkStatusPage() {
  const health = await getApiHealth();
  const contractReady = isContractConfigured();

  return (
    <>
      <TopNav />
      <main className="flex-1 w-full max-w-2xl mx-auto p-4 md:p-12">
        <h1 className="text-3xl font-semibold text-text-primary mb-8">Network Status</h1>
        <div className="flex flex-col gap-4">
          <StatusRow label="API" ok={health.ok} detail={health.status} />
          <StatusRow label="Database" ok={health.db === "up"} detail={health.db ?? "unknown"} />
          <StatusRow
            label="Intelligent Contract"
            ok={contractReady}
            detail={contractReady ? "Deployed on StudioNet" : "Not yet deployed"}
          />
        </div>
      </main>
      <Footer />
    </>
  );
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between bg-surface-elevated border border-border-subtle rounded-lg p-4">
      <span className="text-text-primary">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${ok ? "bg-secondary" : "bg-error"}`} />
        <span className="font-mono text-xs text-text-secondary">{detail}</span>
      </div>
    </div>
  );
}
