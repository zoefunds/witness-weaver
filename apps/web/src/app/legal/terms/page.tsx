import { TopNav } from "@/components/layout/TopNav";
import { Footer } from "@/components/layout/Footer";

export default function TermsPage() {
  return (
    <>
      <TopNav />
      <main className="flex-1 w-full max-w-2xl mx-auto p-4 md:p-12">
        <h1 className="text-3xl font-semibold text-text-primary mb-6">Legal</h1>
        <div className="flex flex-col gap-4 text-text-secondary leading-relaxed">
          <p>
            WitnessWeave produces a credible, validator-checked consensus over submitted testimony and
            evidence — it does not constitute a legal finding, adjudication, or guarantee of objective
            truth. Outcomes should not be treated as a substitute for formal dispute resolution where one
            is required.
          </p>
          <p>
            All GEN transfers (bounty rewards, witness bonds, and settlements) are executed by smart
            contract logic that you interact with directly through your own wallet. WitnessWeave does not
            custody funds outside of the Intelligent Contract's own escrow logic.
          </p>
          <p>
            Submitting fabricated evidence or coordinating false testimony may result in reputation
            penalties and forfeiture of any bonded GEN.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
