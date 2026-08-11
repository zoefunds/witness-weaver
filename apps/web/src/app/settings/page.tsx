"use client";

import { TopNav } from "@/components/layout/TopNav";
import { SideNav } from "@/components/layout/SideNav";
import { Footer } from "@/components/layout/Footer";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/Button";

export default function SettingsPage() {
  const { user, signOut } = useAuth();

  return (
    <>
      <TopNav />
      <div className="flex flex-1 w-full max-w-[1280px] mx-auto">
        <SideNav />
        <main className="flex-1 p-4 md:p-12 max-w-2xl">
          <header className="mb-8 border-b border-border-subtle pb-6">
            <h1 className="text-3xl font-semibold text-text-primary mb-2">Settings</h1>
            <p className="text-text-secondary">Manage your WitnessWeave identity.</p>
          </header>

          {!user ? (
            <p className="text-text-secondary">Sign in to manage your settings.</p>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="bg-surface-elevated border border-border-subtle rounded-lg p-6">
                <h2 className="font-mono text-[10px] uppercase tracking-widest text-text-secondary mb-2">
                  Wallet Address
                </h2>
                <code className="font-mono text-sm text-primary break-all">{user.wallet_address}</code>
                <p className="text-text-secondary text-xs mt-3">
                  Your wallet address is your identity on WitnessWeave — there's no separate username or
                  password. Reputation, testimony history, and bounty ownership are all tied to it.
                </p>
              </div>

              <div className="bg-surface-elevated border border-border-subtle rounded-lg p-6">
                <h2 className="font-mono text-[10px] uppercase tracking-widest text-text-secondary mb-2">Session</h2>
                <Button variant="secondary" onClick={signOut}>
                  Sign Out
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>
      <Footer />
    </>
  );
}
