import { TopNav } from "@/components/layout/TopNav";
import { Footer } from "@/components/layout/Footer";

const SECTIONS = [
  {
    title: "How WitnessWeave works",
    body: "A bounty creator escrows a GEN reward describing a real-world dispute. Independent witnesses submit testimony and evidence. Once the creator (or anyone, after the submission window) triggers evaluation, the Intelligent Contract fetches referenced evidence directly, reasons over corroboration and contradiction, and reaches a validator-checked verdict. The bounty settles automatically based on that verdict.",
  },
  {
    title: "What the contract verifies",
    body: "The contract doesn't just check that its own output is valid JSON — every evaluation is independently re-derived by a validator node, which re-fetches the same evidence and re-runs the judgment, then checks the two results agree within defined numeric tolerances (score deltas, corroboration thresholds, disqualification gates). Only when independent runs substantively agree does the network reach consensus.",
  },
  {
    title: "What a Truth Record means — and doesn't",
    body: "A published Truth Record represents a credible, validator-checked consensus given the evidence available at evaluation time. It is not a claim of omniscient, objective truth — evidence can be incomplete, and the record explicitly distinguishes reported testimony from corroborated fact from disputed claims.",
  },
  {
    title: "Wallets & escrow",
    body: "WitnessWeave uses external wallet authentication only — no custodial keys are ever generated or stored by WitnessWeave. Every escrow deposit, testimony submission, and settlement is a transaction you sign yourself with your own connected wallet.",
  },
];

export default function DocsPage() {
  return (
    <>
      <TopNav />
      <main className="flex-1 w-full max-w-3xl mx-auto p-4 md:p-12">
        <h1 className="text-3xl font-semibold text-text-primary mb-8">Documentation</h1>
        <div className="flex flex-col gap-8">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="text-xl font-medium text-text-primary mb-2">{s.title}</h2>
              <p className="text-text-secondary leading-relaxed">{s.body}</p>
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
