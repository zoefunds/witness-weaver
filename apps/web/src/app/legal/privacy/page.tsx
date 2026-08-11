import { TopNav } from "@/components/layout/TopNav";
import { Footer } from "@/components/layout/Footer";

export default function PrivacyPage() {
  return (
    <>
      <TopNav />
      <main className="flex-1 w-full max-w-2xl mx-auto p-4 md:p-12 prose-invert">
        <h1 className="text-3xl font-semibold text-text-primary mb-6">Privacy Policy</h1>
        <div className="flex flex-col gap-4 text-text-secondary leading-relaxed">
          <p>
            WitnessWeave stores your wallet address, the testimony and evidence links you submit, and
            derived reputation events. Full testimony text and evidence metadata are stored off-chain in
            our database; only a cryptographic hash of your statement and any evidence URLs you provide are
            written to the Intelligent Contract.
          </p>
          <p>
            You may submit testimony anonymously — your wallet address is still recorded internally for
            payout purposes, but is not shown publicly next to anonymous submissions.
          </p>
          <p>
            We do not sell or share your data with third parties. Evidence you upload may be visible to
            anyone able to reach the bounty's public page, so avoid including information you don't want
            publicly associated with the dispute.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
