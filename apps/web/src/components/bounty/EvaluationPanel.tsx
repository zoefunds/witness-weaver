"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { TxLifecycle } from "@/components/tx/TxLifecycle";
import { useGenlayerWrite } from "@/lib/useGenlayerWrite";
import { useAuth } from "@/lib/useAuth";
import { api } from "@/lib/api";
import type { Bounty, Evaluation } from "@/lib/api";

/**
 * Drives the two on-chain steps that turn testimony into a settled outcome:
 * evaluate_bounty (the nondeterministic judgment — a real multi-validator
 * round, so it's slower than a normal write) and settle (the deterministic
 * payout). After each confirms, syncs the resulting on-chain state back
 * into Postgres via /sync-evaluation so the rest of the app (Truth Record,
 * reputation, bounty status) reflects it without a separate backend job.
 */
export function EvaluationPanel({ bounty, evaluation }: { bounty: Bounty; evaluation: Evaluation | null }) {
  const router = useRouter();
  const { user } = useAuth();
  const { write, state, txHash, errorMessage, reset } = useGenlayerWrite();
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const hasVerdict = evaluation?.verdict !== null && evaluation?.verdict !== undefined;

  if (!bounty.chain_bounty_id) return null;
  // Once resolved, there's nothing left for this panel to *drive* — but the
  // verdict itself must stay visible; it's the only place on this page that
  // shows what the validators actually agreed on. Only the action buttons
  // (Start Evaluation / Settle) are gated to the in-progress statuses.
  if (!["open", "evaluating"].includes(bounty.status) && !hasVerdict) return null;

  const isCreator = user?.id === bounty.creator_id;
  const canDriveActions = ["open", "evaluating"].includes(bounty.status);

  async function syncFromChain() {
    setSyncing(true);
    try {
      await api.post(`/bounties/${bounty.id}/sync-evaluation`);
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  async function handleEvaluate() {
    setNote(null);
    reset();
    const result = await write({
      functionName: "evaluate_bounty",
      args: [bounty.chain_bounty_id],
      value: 0n,
      // evaluate_bounty runs a genuine nondeterministic round — web
      // fetches, an LLM call, and multi-validator consensus — which takes
      // meaningfully longer than a plain state write. ~5 minutes of
      // headroom at a slower poll rate.
      pollIntervalMs: 10_000,
      pollRetries: 30,
    });
    if (result) {
      setNote("Evaluation transaction confirmed — pulling the verdict from the contract…");
      await syncFromChain();
    }
  }

  async function handleSettle() {
    setNote(null);
    reset();
    const result = await write({
      functionName: "settle",
      args: [bounty.chain_bounty_id],
      value: 0n,
    });
    if (result) {
      setNote("Settlement confirmed — publishing the Truth Record…");
      await syncFromChain();
      const rec = await api.get<{ truthRecordId: string }>(`/bounties/${bounty.id}/truth-record`).catch(() => null);
      if (rec) router.push(`/truth-records/${rec.truthRecordId}`);
    }
  }

  return (
    <section className="bg-surface-elevated border border-border-subtle rounded-lg p-6 flex flex-col gap-4">
      <h3 className="font-mono text-xs text-primary uppercase tracking-widest border-b border-border-subtle pb-2">
        Evaluation
      </h3>

      {!hasVerdict && (
        <>
          <p className="text-sm text-text-secondary">
            {isCreator
              ? "As the creator, you can start evaluation now. Anyone else can start it once the submission window closes."
              : "Evaluation can be started by the creator now, or automatically once the submission deadline passes — no one needs to click anything for that to happen."}
          </p>
          <TxLifecycle state={state} txHash={txHash} errorMessage={errorMessage} />
          {note && <p className="text-secondary text-sm">{note}</p>}
          <Button type="button" onClick={handleEvaluate} disabled={syncing || (state !== "idle" && state !== "failed" && state !== "rejected" && state !== "timeout")}>
            {syncing ? "Syncing…" : "Start Evaluation"}
          </Button>
        </>
      )}

      {hasVerdict && evaluation && (
        <>
          <div className="flex items-center gap-3">
            <StatusChip status={evaluation.verdict ?? "needs_human_review"} />
            {evaluation.confidence_bps !== null && (
              <span className="font-mono text-xs text-text-secondary">
                {(evaluation.confidence_bps / 100).toFixed(1)}% confidence
              </span>
            )}
          </div>
          {evaluation.rationale && <p className="text-sm text-text-secondary">{evaluation.rationale}</p>}

          {!canDriveActions ? null : evaluation.verdict === "needs_human_review" ? (
            <p className="text-tertiary text-sm">
              The contract couldn&apos;t reach a confident verdict. It can&apos;t settle until re-evaluated with
              more evidence, or until the timeout is reached and the creator reclaims the reward.
            </p>
          ) : (
            <>
              <TxLifecycle state={state} txHash={txHash} errorMessage={errorMessage} />
              {note && <p className="text-secondary text-sm">{note}</p>}
              <Button
                type="button"
                onClick={handleSettle}
                disabled={syncing || (state !== "idle" && state !== "failed" && state !== "rejected" && state !== "timeout")}
              >
                {syncing ? "Syncing…" : "Settle Bounty"}
              </Button>
            </>
          )}
        </>
      )}
    </section>
  );
}
