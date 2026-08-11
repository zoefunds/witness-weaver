"use client";

import { TopNav } from "@/components/layout/TopNav";
import { SideNav } from "@/components/layout/SideNav";
import { Footer } from "@/components/layout/Footer";
import { LinkButton } from "@/components/ui/Button";
import { useAuth } from "@/lib/useAuth";
import { shortAddress } from "@/lib/format";

export default function DashboardPage() {
  const { user, isConnected, status, signIn } = useAuth();

  return (
    <>
      <TopNav />
      <div className="flex flex-1 w-full max-w-[1280px] mx-auto">
        <SideNav />
        <main className="flex-1 p-4 md:p-12">
          <header className="mb-8 border-b border-border-subtle pb-6">
            <h1 className="text-3xl font-semibold text-text-primary mb-2">Dashboard</h1>
            <p className="text-text-secondary">
              {user ? `Signed in as ${shortAddress(user.wallet_address)}` : "Connect and sign in to view your activity."}
            </p>
          </header>

          {!user && (
            <div className="border border-dashed border-border-subtle rounded-lg p-16 flex flex-col items-center text-center gap-3">
              <span className="text-4xl">🔐</span>
              <h2 className="text-lg font-medium text-text-primary">Not signed in</h2>
              <p className="text-text-secondary max-w-sm">
                {isConnected
                  ? "Your wallet is connected — sign the challenge message to open a session."
                  : "Connect a GenLayer-compatible wallet to view your bounties, testimonies, and reputation."}
              </p>
              {isConnected && (
                <button
                  onClick={signIn}
                  disabled={status === "signing"}
                  className="mt-2 bg-primary-container text-white px-5 py-2.5 rounded font-mono text-xs"
                >
                  {status === "signing" ? "Check wallet…" : "Sign in"}
                </button>
              )}
            </div>
          )}

          {user && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <DashCard href="/dashboard/testimonies" title="My Testimonies" icon="📝" description="Testimony you've submitted and its evaluation status." />
              <DashCard href="/discover" title="Open Bounties" icon="🎖" description="Bounties currently accepting witness testimony." />
              <DashCard href="/dashboard/reputation" title="Reputation" icon="🛡" description="Your credibility ledger, derived from corroborated testimony." />
              <DashCard href="/bounties/new" title="Create Bounty" icon="➕" description="Open a new Testimony Bounty and escrow a GEN reward." />
              <DashCard href="/settings" title="Settings" icon="⚙" description="Manage your profile." />
            </div>
          )}
        </main>
      </div>
      <Footer />
    </>
  );
}

function DashCard({ href, title, icon, description }: { href: string; title: string; icon: string; description: string }) {
  return (
    <LinkButton href={href} variant="secondary" className="!flex-col !items-start !text-left !p-6 !h-auto gap-2 normal-case">
      <span className="text-2xl">{icon}</span>
      <span className="text-base font-medium text-text-primary normal-case">{title}</span>
      <span className="text-xs text-text-secondary normal-case tracking-normal font-sans">{description}</span>
    </LinkButton>
  );
}
