"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseEther } from "viem";
import { TopNav } from "@/components/layout/TopNav";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/Button";
import { TxLifecycle } from "@/components/tx/TxLifecycle";
import { useGenlayerWrite } from "@/lib/useGenlayerWrite";
import { api, ApiError, type Bounty } from "@/lib/api";
import { isContractConfigured } from "@/lib/genlayer-client";

const INCIDENT_TYPES = [
  "Delivery dispute",
  "Product damage",
  "Property damage",
  "Workplace incident",
  "Service dispute",
  "Public incident",
  "Other",
];

export default function CreateBountyPage() {
  const router = useRouter();
  const { write, state, txHash, errorMessage, reset } = useGenlayerWrite();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Once the off-chain draft is created, we hold onto it so a failed/rejected
  // escrow transaction can be retried without creating a second duplicate
  // bounty row — retry only re-runs the wallet transaction, not the form.
  const [draftBounty, setDraftBounty] = useState<Bounty | null>(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    incidentType: INCIDENT_TYPES[0],
    locationContext: "",
    evidenceRequirements: "",
    rewardGen: "",
    witnessBondGen: "0",
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submitOrRetry();
  }

  async function submitOrRetry() {
    setFormError(null);

    if (!form.title || !form.description || !form.rewardGen) {
      setFormError("Title, description, and reward are required.");
      return;
    }

    let rewardWei: bigint;
    try {
      rewardWei = parseEther(form.rewardGen);
      if (rewardWei <= 0n) throw new Error();
    } catch {
      setFormError("Reward must be a positive GEN amount.");
      return;
    }

    setSubmitting(true);
    try {
      // 1. Create the off-chain draft row first so we have an id to attach
      //    the on-chain tx hash to as soon as the wallet signs. Only done
      //    once — if the user retries after a failed escrow tx, we reuse
      //    this same draft instead of creating a duplicate.
      const bounty =
        draftBounty ??
        (
          await api.post<{ bounty: Bounty }>("/bounties", {
            title: form.title,
            description: form.description,
            incidentType: form.incidentType,
            locationContext: form.locationContext || undefined,
            evidenceRequirements: form.evidenceRequirements || undefined,
            rewardWei: rewardWei.toString(),
            witnessBondWei: parseEther(form.witnessBondGen || "0").toString(),
          })
        ).bounty;
      setDraftBounty(bounty);

      // 2. Send the wallet-signed create_bounty transaction, escrowing the
      //    reward as gl.message.value on the contract.
      const result = await write({
        functionName: "create_bounty",
        args: [
          form.title,
          form.description,
          form.evidenceRequirements ?? "",
          // The contract's `witness_bond_wei` parameter is typed as plain
          // `int` (GenVM calldata schema only supports primitive parameter
          // types on public methods — u256 isn't schema-safe as an input
          // type, only str/int/bool are). genlayer-js's calldata encoder
          // accepts a bigint directly for an int-typed parameter without
          // the JS Number precision loss a wei-scale value would suffer.
          parseEther(form.witnessBondGen || "0"),
          20, // submission_window_epochs — the contract's virtual-epoch clock, not wall-clock time
          40, // evaluation_timeout_epochs
        ],
        value: rewardWei,
      });

      if (result) {
        await api.patch(`/bounties/${bounty.id}/chain-sync`, {
          createTxHash: result.txHash,
          status: "open",
          rewardDepositedWei: rewardWei.toString(),
        });
        router.push(`/bounties/${bounty.id}`);
      }
      // If the escrow transaction failed or was rejected, `result` is null
      // and `write()` has already set `state`/`errorMessage` — we deliberately
      // do NOT navigate away here, so that failure stays visible and the
      // "Retry Escrow Transaction" button below can re-attempt funding this
      // same draft.
    } catch (err) {
      setFormError(err instanceof ApiError ? `Couldn't save bounty (${err.status}).` : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <TopNav active="/bounties/new" />
      <main className="flex-1 w-full max-w-2xl mx-auto p-4 md:p-12">
        <h1 className="text-3xl font-semibold text-text-primary mb-2">Open a Testimony Bounty</h1>
        <p className="text-text-secondary mb-8">
          Describe the dispute and escrow a GEN reward. The reward stays locked in the Intelligent Contract
          until an evaluation reaches a verdict.
        </p>

        {!isContractConfigured() && (
          <div className="mb-6 bg-tertiary/10 border border-tertiary/30 text-tertiary rounded-lg p-4 text-sm">
            The Intelligent Contract hasn&apos;t been deployed yet, so on-chain escrow isn&apos;t live. You can
            still draft a bounty now — funding will be available once deployment completes.
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Field label="Title">
            <input
              className="input"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              maxLength={200}
              required
            />
          </Field>

          <Field label="Description">
            <textarea
              className="input min-h-32"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              maxLength={5000}
              required
            />
          </Field>

          <Field label="Incident Type">
            <select className="input" value={form.incidentType} onChange={(e) => set("incidentType", e.target.value)}>
              {INCIDENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Location / Context (optional)">
            <input className="input" value={form.locationContext} onChange={(e) => set("locationContext", e.target.value)} />
          </Field>

          <Field label="Evidence Requirements (optional)">
            <textarea
              className="input min-h-20"
              value={form.evidenceRequirements}
              onChange={(e) => set("evidenceRequirements", e.target.value)}
              placeholder="e.g. time-stamped visuals, delivery logs, receipts..."
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Reward (GEN)">
              <input
                className="input"
                type="number"
                min="0"
                step="0.0001"
                value={form.rewardGen}
                onChange={(e) => set("rewardGen", e.target.value)}
                required
              />
            </Field>
            <Field label="Witness Bond (GEN, optional)">
              <input
                className="input"
                type="number"
                min="0"
                step="0.0001"
                value={form.witnessBondGen}
                onChange={(e) => set("witnessBondGen", e.target.value)}
              />
            </Field>
          </div>

          {formError && <p className="text-error text-sm">{formError}</p>}
          <TxLifecycle state={state} txHash={txHash} errorMessage={errorMessage} />

          {draftBounty && ["rejected", "failed", "timeout"].includes(state) ? (
            <div className="flex flex-col gap-2">
              <p className="text-text-secondary text-sm">
                Your bounty details were saved, but the escrow transaction didn&apos;t go through. Nothing was
                lost — retry funding it, or come back to this later from{" "}
                <span className="text-primary">the bounty page</span> (status: draft, unfunded).
              </p>
              <Button
                type="button"
                onClick={() => {
                  reset();
                  submitOrRetry();
                }}
                disabled={submitting}
              >
                {submitting ? "Retrying…" : "Retry Escrow Transaction"}
              </Button>
            </div>
          ) : (
            <Button type="submit" disabled={submitting} className="mt-2">
              {submitting ? "Submitting…" : "Create Bounty & Escrow Reward"}
            </Button>
          )}
        </form>
      </main>
      <Footer />

      <style>{`
        .input {
          width: 100%;
          background: var(--color-background-deep);
          border: 1px solid var(--color-border-subtle);
          border-radius: 0.25rem;
          padding: 0.625rem 0.75rem;
          font-size: 0.875rem;
          color: var(--color-text-primary);
        }
        .input:focus {
          outline: none;
          border-color: var(--color-primary-container);
          box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary-container) 20%, transparent);
        }
      `}</style>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">{label}</span>
      {children}
    </label>
  );
}
