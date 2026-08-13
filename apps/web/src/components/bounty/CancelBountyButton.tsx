"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { TxLifecycle } from "@/components/tx/TxLifecycle";
import { useGenlayerWrite } from "@/lib/useGenlayerWrite";
import { useAuth } from "@/lib/useAuth";
import { api } from "@/lib/api";
import type { Bounty } from "@/lib/api";

/**
 * The contract implements cancel_bounty (creator-only, only while status is
 * OPEN, only before any testimony has been submitted — refunds the full
 * escrow back to the creator) but nothing in the frontend ever called it.
 * Once a witness has contributed in good faith, cancellation is no longer
 * possible on-chain — the contract itself enforces that, this component
 * just mirrors the same gating client-side so the button doesn't appear
 * when it would only fail.
 */
export function CancelBountyButton({ bounty, testimonyCount }: { bounty: Bounty; testimonyCount: number }) {
  const router = useRouter();
  const { user } = useAuth();
  const { write, state, txHash, errorMessage } = useGenlayerWrite();
  const [syncing, setSyncing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (!bounty.chain_bounty_id) return null;
  if (bounty.status !== "open") return null;
  if (testimonyCount > 0) return null;
  if (user?.id !== bounty.creator_id) return null;

  async function handleCancel() {
    setConfirming(false);
    const result = await write({ functionName: "cancel_bounty", args: [bounty.chain_bounty_id], value: 0n });
    if (result) {
      setSyncing(true);
      try {
        await api.post(`/bounties/${bounty.id}/sync-evaluation`);
      } finally {
        setSyncing(false);
      }
      router.refresh();
    }
  }

  return (
    <div className="bg-surface-elevated border border-border-subtle rounded-lg p-4 flex flex-col gap-3">
      <p className="text-xs text-text-secondary">
        No testimony has been submitted yet — you can still cancel this bounty and reclaim the full escrowed
        reward. Once a witness submits, this option disappears for good.
      </p>
      <TxLifecycle state={state} txHash={txHash} errorMessage={errorMessage} />
      {confirming ? (
        <div className="flex items-center gap-3">
          <span className="text-sm text-error">Cancel and refund the reward to yourself?</span>
          <Button type="button" variant="secondary" onClick={handleCancel} disabled={syncing}>
            {syncing ? "Syncing…" : "Confirm Cancel"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
            Keep Bounty
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setConfirming(true)}
          disabled={state === "pending" || state === "submitted"}
        >
          Cancel Bounty
        </Button>
      )}
    </div>
  );
}
