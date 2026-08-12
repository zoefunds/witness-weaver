import { TopNav } from "@/components/layout/TopNav";
import { SideNav } from "@/components/layout/SideNav";
import { Footer } from "@/components/layout/Footer";
import { BountyCard } from "@/components/bounty/BountyCard";
import { LinkButton } from "@/components/ui/Button";
import type { Bounty } from "@/lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

async function getBounties(): Promise<{ bounties: Bounty[]; reachable: boolean }> {
  try {
    const res = await fetch(`${API_BASE_URL}/bounties`, { cache: "no-store" });
    if (!res.ok) return { bounties: [], reachable: true };
    const data = await res.json();
    return { bounties: data.bounties ?? [], reachable: true };
  } catch {
    return { bounties: [], reachable: false };
  }
}

export default async function DiscoverPage() {
  const { bounties, reachable } = await getBounties();

  return (
    <>
      <TopNav active="/discover" />
      <div className="flex flex-1 w-full max-w-[1280px] mx-auto">
        <SideNav active="/discover" />
        <main className="flex-1 min-w-0 p-4 md:p-12">
          <header className="mb-8 border-b border-border-subtle pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold text-text-primary mb-2">Discover Bounties</h1>
              <p className="text-text-secondary max-w-xl">
                Open testimony bounties awaiting witness accounts and evidence.
              </p>
            </div>
            <LinkButton href="/bounties/new">Open a Bounty</LinkButton>
          </header>

          {!reachable && (
            <div className="mb-6 bg-error-container/20 border border-error/30 text-error rounded-lg p-4 text-sm">
              Couldn&apos;t reach the WitnessWeave API. Bounty data can&apos;t load right now — check that the
              backend service is running.
            </div>
          )}

          {reachable && bounties.length === 0 && (
            <div className="border border-dashed border-border-subtle rounded-lg p-16 flex flex-col items-center text-center gap-3">
              <span className="text-4xl">🗒</span>
              <h2 className="text-lg font-medium text-text-primary">No bounties yet</h2>
              <p className="text-text-secondary max-w-sm">
                Be the first to open a Testimony Bounty and start gathering verified witness accounts.
              </p>
              <LinkButton href="/bounties/new" className="mt-2">
                Open a Bounty
              </LinkButton>
            </div>
          )}

          {bounties.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {bounties.map((bounty) => (
                <BountyCard key={bounty.id} bounty={bounty} />
              ))}
            </div>
          )}
        </main>
      </div>
      <Footer />
    </>
  );
}
