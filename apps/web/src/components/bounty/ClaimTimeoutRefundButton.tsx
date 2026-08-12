"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { TxLifecycle } from "@/components/tx/TxLifecycle";
import { useGenlayerWrite } from "@/lib/useGenlayerWrite";
import type { Bounty } from "@/lib/api";

/**
 * The recovery exit for a bounty whose evaluation never happened or never
 * reached a settleable verdict — permissionless by design (the contract
 * doesn't check who calls it, only that the timeout has actually passed),
 * so it's shown to anyone, not gated to the creator. Funds always return to
 * the original creator regardless of who triggers the claim. If the
 * timeout hasn't passed yet, the contract itself rejects with a clear
 * message rather than this component trying to predict on-chain epoch
 * timing client-side.
 */
export function ClaimTimeoutRefundButton({ bounty }: { bounty: Bounty }) {
  const router = useRouter();
  const { write, state, txHash, errorMessage } = useGenlayerWrite();

  if (!bounty.chain_bounty_id) return null;
  if (!["open", "evaluating"].includes(bounty.status)) return null;

  async function handleClaim() {
    const result = await write({ functionName: "claim_timeout_refund", args: [bounty.chain_bounty_id], value: 0n });
    if (result) router.refresh();
  }

  return (
    <details className="bg-surface-elevated border border-border-subtle rounded-lg p-4">
      <summary className="text-sm text-text-secondary cursor-pointer select-none">
        Evaluation stalled? Reclaim the reward after timeout
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-xs text-text-secondary">
          If this bounty&apos;s evaluation timeout has passed without resolving, anyone can trigger a full
          refund back to the creator — funds are never locked forever. The contract will reject this if the
          timeout hasn&apos;t actually passed yet.
        </p>
        <TxLifecycle state={state} txHash={txHash} errorMessage={errorMessage} />
        <Button type="button" variant="secondary" onClick={handleClaim} disabled={state === "pending" || state === "submitted"}>
          Claim Timeout Refund
        </Button>
      </div>
    </details>
  );
}
