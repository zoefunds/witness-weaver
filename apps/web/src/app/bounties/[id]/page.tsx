import { notFound } from "next/navigation";
import { TopNav } from "@/components/layout/TopNav";
import { SideNav } from "@/components/layout/SideNav";
import { Footer } from "@/components/layout/Footer";
import { StatusChip } from "@/components/ui/StatusChip";
import { LinkButton } from "@/components/ui/Button";
import { FundEscrowButton } from "@/components/bounty/FundEscrowButton";
import { EvaluationPanel } from "@/components/bounty/EvaluationPanel";
import { ClaimTimeoutRefundButton } from "@/components/bounty/ClaimTimeoutRefundButton";
import { formatGen, shortHash, timeAgo } from "@/lib/format";
import { getChainBounty, type ChainBountyFull } from "@/lib/genlayer-client";
import type { Bounty, Evaluation, Testimony } from "@/lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

async function getBounty(id: string) {
  try {
    const res = await fetch(`${API_BASE_URL}/bounties/${id}`, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) return "unreachable" as const;
    return (await res.json()) as { bounty: Bounty; testimonies: Testimony[]; evaluation: Evaluation | null };
  } catch {
    return "unreachable" as const;
  }
}

/**
 * The contract, not our Postgres mirror, is the source of truth for
 * deadlines — read directly here (this runs server-side, so it can call
 * getChainBounty freely) rather than trusting whatever was last synced
 * into the database, which could be stale.
 */
async function getDeadlines(chainBountyId: string | null, isStale: boolean): Promise<ChainBountyFull | null> {
  if (!chainBountyId || isStale) return null;
  try {
    return await getChainBounty(chainBountyId);
  } catch {
    return null;
  }
}

export default async function BountyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getBounty(id);

  if (data === null) notFound();

  const isStale =
    data !== "unreachable" &&
    !!data.bounty.contract_address &&
    !!process.env.NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS &&
    data.bounty.contract_address.toLowerCase() !== process.env.NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS.toLowerCase();
  const chainBounty =
    data !== "unreachable" ? await getDeadlines(data.bounty.chain_bounty_id, isStale) : null;

  return (
    <>
      <TopNav />
      <div className="flex flex-1 w-full max-w-[1280px] mx-auto">
        <SideNav />
        <main className="flex-1 p-4 md:p-12">
          {data === "unreachable" ? (
            <div className="bg-error-container/20 border border-error/30 text-error rounded-lg p-4 text-sm">
              Couldn&apos;t reach the WitnessWeave API to load this bounty.
            </div>
          ) : (
            <BountyDetail data={data} isStale={isStale} chainBounty={chainBounty} />
          )}
        </main>
      </div>
      <Footer />
    </>
  );
}

function BountyDetail({
  data,
  isStale,
  chainBounty,
}: {
  data: { bounty: Bounty; testimonies: Testimony[]; evaluation: Evaluation | null };
  isStale: boolean;
  chainBounty: ChainBountyFull | null;
}) {
  const { bounty, testimonies, evaluation } = data;
  const deadlinePassed = chainBounty ? Date.now() / 1000 > chainBounty.submission_deadline_ts : false;
  const canSubmitTestimony = !isStale && !deadlinePassed && (bounty.status === "open" || bounty.status === "evaluating");

  return (
    <>
      <header className="mb-8 border-b border-border-subtle pb-6 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary px-2 py-0.5 bg-surface-elevated border border-border-subtle rounded">
              Bounty {bounty.chain_bounty_id ? shortHash(bounty.chain_bounty_id) : shortHash(bounty.id)}
            </span>
            <StatusChip status={bounty.status} pulse={bounty.status === "evaluating"} />
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold text-text-primary mb-2">{bounty.title}</h1>
          <p className="text-text-secondary max-w-2xl">{bounty.description}</p>
        </div>
        <div className="flex flex-col items-end gap-2 bg-surface-elevated p-4 rounded-lg border border-border-subtle">
          <span className="font-mono text-[10px] text-text-secondary uppercase">Bounty Reward</span>
          <span className="text-xl font-semibold text-secondary">{formatGen(bounty.reward_wei)}</span>
        </div>
      </header>

      {isStale && (
        <div className="mb-6 bg-error-container/20 border border-error/30 text-error rounded-lg p-4 text-sm">
          This bounty&apos;s escrow lives on a previous Intelligent Contract deployment (
          <code className="font-mono text-xs">{bounty.contract_address}</code>), not the one currently live.
          Its on-chain state can no longer be read or acted on through this app.
        </div>
      )}

      {!isStale && (
        <div className="mb-6">
          <FundEscrowButton bounty={bounty} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 flex flex-col gap-6">
          <section className="bg-surface-elevated border border-border-subtle rounded-lg p-6">
            <h3 className="font-mono text-xs text-primary uppercase tracking-widest mb-4 border-b border-border-subtle pb-2">
              Claim Parameters
            </h3>
            <table className="w-full text-left font-mono text-xs border-collapse">
              <tbody>
                <tr className="border-b border-border-subtle/50">
                  <td className="py-2 text-text-secondary">Incident Type</td>
                  <td className="py-2 text-on-surface text-right">{bounty.incident_type}</td>
                </tr>
                {bounty.incident_occurred_at && (
                  <tr className="border-b border-border-subtle/50">
                    <td className="py-2 text-text-secondary">Incident Date</td>
                    <td className="py-2 text-on-surface text-right">
                      {new Date(bounty.incident_occurred_at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                  </tr>
                )}
                {bounty.location_context && (
                  <tr className="border-b border-border-subtle/50">
                    <td className="py-2 text-text-secondary">Location / Context</td>
                    <td className="py-2 text-on-surface text-right">{bounty.location_context}</td>
                  </tr>
                )}
                <tr>
                  <td className="py-2 text-text-secondary">Witness Bond</td>
                  <td className="py-2 text-primary text-right">{formatGen(bounty.witness_bond_wei)}</td>
                </tr>
                {chainBounty && (
                  <tr className="border-t border-border-subtle/50">
                    <td className="py-2 text-text-secondary">Submission Deadline</td>
                    <td className={`py-2 text-right ${deadlinePassed ? "text-error" : "text-on-surface"}`}>
                      {new Date(chainBounty.submission_deadline_ts * 1000).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                      {deadlinePassed && " (closed)"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {bounty.evidence_requirements && (
            <section className="bg-surface-elevated border border-border-subtle rounded-lg p-6">
              <h3 className="font-mono text-xs text-primary uppercase tracking-widest mb-4 border-b border-border-subtle pb-2">
                Evidence Requirements
              </h3>
              <p className="text-sm text-text-secondary whitespace-pre-line">{bounty.evidence_requirements}</p>
            </section>
          )}

          {!isStale && (
            <>
              <EvaluationPanel bounty={bounty} evaluation={evaluation} />
              <ClaimTimeoutRefundButton bounty={bounty} />
            </>
          )}

          {bounty.status === "resolved" && (
            <LinkButton href={`/bounties/${bounty.id}/truth-record`} variant="secondary" className="w-full">
              View Truth Record
            </LinkButton>
          )}
        </div>

        <div className="lg:col-span-7 flex flex-col">
          <div className="flex items-center justify-between mb-4 border-b border-border-subtle pb-2">
            <h2 className="text-lg font-medium text-text-primary">Testimony Ledger</h2>
            <span className="font-mono text-[10px] text-text-secondary bg-surface-elevated px-2 py-1 rounded border border-border-subtle">
              {testimonies.length} Submission{testimonies.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="flex-1 space-y-4 pb-24">
            {testimonies.length === 0 ? (
              <div className="border border-dashed border-border-subtle rounded-lg p-10 text-center text-text-secondary text-sm">
                No testimony submitted yet. Be the first witness to contribute evidence.
              </div>
            ) : (
              testimonies.map((t) => (
                <article key={t.id} className="bg-surface-elevated border border-border-subtle rounded-lg p-5">
                  <header className="flex items-center justify-between mb-3">
                    <span className="font-mono text-xs text-on-surface">
                      {t.is_anonymous ? "Anonymous Witness" : `Witness ${shortHash(t.submitter_id)}`}
                    </span>
                    <StatusChip status={t.status} />
                  </header>
                  <p className="text-sm text-on-surface-variant mb-4">{t.statement}</p>
                  {t.evidence && t.evidence.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {t.evidence.map((e) => (
                        <a
                          key={e.id}
                          href={e.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[10px] text-primary hover:underline flex items-center gap-1 bg-background-deep px-2 py-1 rounded border border-border-subtle max-w-[220px]"
                        >
                          <span className="uppercase text-text-secondary shrink-0">{e.kind}</span>
                          <span className="truncate min-w-0">{e.url}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  <footer className="flex items-center justify-between border-t border-border-subtle/50 pt-3">
                    <span className="font-mono text-[10px] text-text-secondary opacity-70">
                      Hash: {shortHash(t.statement_hash)}
                    </span>
                    <span className="font-mono text-[10px] text-text-secondary">{timeAgo(t.created_at)}</span>
                  </footer>
                </article>
              ))
            )}
          </div>

          {/* Both `sticky` and `fixed` caused problems here: `sticky` only
              tracks its own (shorter) column, so it detached and drifted
              once the taller sidebar column finished scrolling; `fixed`
              takes it out of the grid entirely, so at narrower widths it
              floats over the sidebar column instead of the ledger it
              belongs to. Rendering it as a normal block at the end of the
              ledger column avoids both — it just sits in flow like every
              other card here. */}
          {canSubmitTestimony && (
            <div className="mt-6 bg-surface-elevated/95 border border-border-subtle rounded-lg p-4 flex items-center justify-between">
              <div>
                <span className="block text-sm text-on-surface mb-1">Have relevant evidence?</span>
                <span className="block font-mono text-[10px] text-text-secondary">
                  Contribute to resolving this bounty and earn GEN.
                </span>
              </div>
              <LinkButton href={`/bounties/${bounty.id}/submit`}>Submit Testimony</LinkButton>
            </div>
          )}

          {!isStale && !canSubmitTestimony && deadlinePassed && (bounty.status === "open" || bounty.status === "evaluating") && (
            <div className="mt-6 bg-tertiary/10 border border-tertiary/30 rounded-lg p-4 text-sm text-tertiary">
              The submission deadline has passed — testimony can no longer be added. Evaluation will start
              automatically shortly, or the creator can start it immediately.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
