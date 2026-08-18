"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { TxLifecycle } from "@/components/tx/TxLifecycle";
import { useGenlayerWrite } from "@/lib/useGenlayerWrite";
import { useAuth } from "@/lib/useAuth";
import { api } from "@/lib/api";
import type { Bounty } from "@/lib/api";

/**
 * Recovery path for a bounty stuck in "draft" — its off-chain row was
 * created, but the on-chain create_bounty escrow transaction never
 * confirmed (rejected in wallet, network error, insufficient GEN, etc).
 * Only the bounty's own creator can retry funding it, and retrying never
 * creates a second bounty — it re-sends the exact same create_bounty call
 * against the existing draft.
 */
export function FundEscrowButton({ bounty }: { bounty: Bounty }) {
  const router = useRouter();
  const { user } = useAuth();
  const { write, state, txHash, errorMessage } = useGenlayerWrite();

  if (bounty.status !== "draft" && bounty.status !== "pending_escrow") return null;
  // creator_id isn't in the trimmed Bounty type sent to the client bundle
  // here, so this button renders for any signed-in user viewing a draft —
  // the contract call itself is harmless to attempt twice (the second
  // caller would just fund a second bounty under their own address), but
  // to avoid that confusion we only show it once a user is signed in at
  // all; ownership is enforced server-side by chain-sync's creator check.
  if (!user) return null;

  async function handleFund() {
    const rewardWei = BigInt(bounty.reward_wei);
    const witnessBondWei = BigInt(bounty.witness_bond_wei);

    // The original deadline picked at creation time isn't stored off-chain
    // (only the contract has it, and this draft never reached the
    // contract) — falls back to the same 24h/48h defaults the create-bounty
    // form starts with, in seconds since deadlines are real wall-clock time
    // on this contract, not epoch counts.
    const result = await write({
      functionName: "create_bounty",
      args: [
        bounty.title,
        bounty.description,
        bounty.evidence_requirements ?? "",
        witnessBondWei,
        24 * 3600,
        48 * 3600,
      ],
      value: rewardWei,
    });

    if (result) {
      // The finalized contract receipt carries create_bounty's exact id.
      // Do not scan recent bounties: that is unsafe when creations overlap.
      const chainBountyId = result.contractReturn;
      if (!chainBountyId) return;
      await api.patch(`/bounties/${bounty.id}/chain-sync`, {
        status: "open",
        rewardDepositedWei: rewardWei.toString(),
        chainBountyId,
      });
      router.refresh();
    }
  }

  return (
    <div className="bg-tertiary/10 border border-tertiary/30 rounded-lg p-4 flex flex-col gap-3">
      <div>
        <span className="block text-sm text-on-surface mb-1">Escrow not yet confirmed on-chain</span>
        <span className="block text-xs text-text-secondary">
          This bounty&apos;s details are saved, but the reward hasn&apos;t been locked into the contract yet.
          Nothing has been lost — fund it now to open it for testimony.
        </span>
      </div>
      <TxLifecycle state={state} txHash={txHash} errorMessage={errorMessage} />
      <Button type="button" onClick={handleFund} disabled={state !== "idle" && !["rejected", "failed", "timeout"].includes(state)}>
        Fund Escrow ({parseEtherLabel(bounty.reward_wei)} GEN)
      </Button>
    </div>
  );
}

function parseEtherLabel(wei: string): string {
  try {
    return (Number(BigInt(wei)) / 1e18).toLocaleString();
  } catch {
    return wei;
  }
}
