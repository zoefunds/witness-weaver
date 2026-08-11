import { TopNav } from "@/components/layout/TopNav";
import { Footer } from "@/components/layout/Footer";
import { LinkButton } from "@/components/ui/Button";

export default function LandingPage() {
  return (
    <>
      <TopNav />
      <main className="flex-1 flex flex-col items-center w-full max-w-[1280px] mx-auto px-4 md:px-12 py-16 md:py-24 gap-24 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary-container opacity-5 blur-[120px] rounded-full pointer-events-none -z-10" />

        <section className="flex flex-col items-center text-center gap-8 max-w-3xl z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border-subtle bg-surface-elevated/50 text-tertiary font-mono text-[10px] uppercase tracking-widest backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary-container animate-pulse" />
            GenLayer StudioNet — Intelligent Contract Live
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1]">
            Turn real-world testimony into a{" "}
            <span className="text-primary-container">living truth layer.</span>
          </h1>
          <p className="text-base md:text-lg text-text-secondary max-w-2xl leading-relaxed">
            Open a Testimony Bounty on any real-world dispute. Independent witnesses submit accounts and
            evidence. A GenLayer Intelligent Contract corroborates, weighs contradictions, and settles the
            bounty in GEN from escrow — publishing a credible consensus, not a claim of objective truth.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 mt-4 w-full sm:w-auto">
            <LinkButton href="/bounties/new" className="px-8 py-3 text-sm">
              Open a Bounty
            </LinkButton>
            <LinkButton href="/discover" variant="secondary" className="px-8 py-3 text-sm">
              Browse Bounties
            </LinkButton>
          </div>
        </section>

        <section className="w-full grid grid-cols-1 md:grid-cols-12 gap-6 z-10">
          <div className="md:col-span-8 glass-panel rounded-xl p-8 flex flex-col gap-6 relative overflow-hidden">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center border border-border-subtle text-primary">
                ⚖
              </div>
              <h3 className="text-xl font-semibold">Testimony Bounties</h3>
            </div>
            <p className="text-sm text-text-secondary max-w-md">
              Escrow a GEN reward and describe the dispute — a delivery, a damaged product, a workplace
              incident. Independent witnesses submit accounts; funds stay locked in the contract until a
              verdict is reached.
            </p>
          </div>

          <div className="md:col-span-4 glass-panel rounded-xl p-8 flex flex-col gap-6 relative overflow-hidden">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center border border-border-subtle text-secondary">
                👁
              </div>
              <h3 className="text-lg font-medium">Witness Net</h3>
            </div>
            <p className="text-sm text-text-secondary">
              Submit written testimony alongside photos, documents, and URLs. Choose to submit anonymously
              or under your reputation-linked wallet address.
            </p>
          </div>

          <div className="md:col-span-5 glass-panel rounded-xl p-8 flex flex-col gap-6 relative overflow-hidden">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center border border-border-subtle text-primary-container">
                🧠
              </div>
              <h3 className="text-lg font-medium">GenLayer Analysis</h3>
            </div>
            <p className="text-sm text-text-secondary">
              The Intelligent Contract fetches referenced web pages and images directly, cross-references
              timelines, and reasons over corroboration and contradiction — with independent validator
              nodes checking the actual outcome, not just output format.
            </p>
          </div>

          <div className="md:col-span-7 glass-panel truth-border rounded-xl p-8 flex flex-col gap-6 relative overflow-hidden">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center border border-border-subtle text-secondary-container">
                📜
              </div>
              <h3 className="text-xl font-semibold">Immutable Truth Records</h3>
            </div>
            <p className="text-sm text-text-secondary">
              Once validator consensus is reached, the outcome — verdict, confidence, rationale, and the
              GEN settlement transaction — is published as a permanent, publicly readable Truth Record.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
