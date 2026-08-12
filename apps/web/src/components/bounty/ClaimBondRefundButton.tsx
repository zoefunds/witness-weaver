"use client";

import { Button } from "@/components/ui/Button";
import { useGenlayerWrite } from "@/lib/useGenlayerWrite";
import { formatGen } from "@/lib/format";

interface ClaimableTestimony {
  chain_testimony_id: string | null;
  bond_deposited_wei: string;
  bond_claimed: boolean;
}

/**
 * A witness bond is only refundable once the parent bounty reaches a
 * terminal state (resolved/timed-out/cancelled) — deliberately not
 * predicted client-side; the contract itself is the source of truth and
 * rejects with a clear message if called too early, same pattern used for
 * the other claim buttons.
 */
export function ClaimBondRefundButton({ testimony, onClaimed }: { testimony: ClaimableTestimony; onClaimed?: () => void }) {
  const { write, state, errorMessage } = useGenlayerWrite();

  if (!testimony.chain_testimony_id) return null;
  if (testimony.bond_claimed) return null;
  if (testimony.bond_deposited_wei === "0") return null;

  async function handleClaim() {
    const result = await write({
      functionName: "claim_bond_refund",
      args: [testimony.chain_testimony_id],
      value: 0n,
    });
    if (result) onClaimed?.();
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        onClick={handleClaim}
        disabled={state === "pending" || state === "submitted"}
        className="!px-3 !py-1.5 !text-[10px]"
      >
        Claim Bond ({formatGen(testimony.bond_deposited_wei)})
      </Button>
      {errorMessage && ["rejected", "failed"].includes(state) && (
        <span className="text-error text-[10px] max-w-[200px] truncate" title={errorMessage}>
          {errorMessage}
        </span>
      )}
    </div>
  );
}
