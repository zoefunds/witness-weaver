import { TopNav } from "@/components/layout/TopNav";
import { Footer } from "@/components/layout/Footer";
import { LinkButton } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <>
      <TopNav />
      <main className="flex-1 flex flex-col items-center justify-center gap-4 p-12 text-center">
        <span className="text-5xl">🗂</span>
        <h1 className="text-2xl font-semibold text-text-primary">Record not found</h1>
        <p className="text-text-secondary max-w-sm">
          Nothing on the ledger matches this address. It may have been moved or never existed.
        </p>
        <LinkButton href="/discover">Browse Bounties</LinkButton>
      </main>
      <Footer />
    </>
  );
}
