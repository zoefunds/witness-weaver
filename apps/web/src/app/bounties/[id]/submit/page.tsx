"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { keccak256, toBytes } from "viem";
import { TopNav } from "@/components/layout/TopNav";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/Button";
import { TxLifecycle } from "@/components/tx/TxLifecycle";
import { useGenlayerWrite } from "@/lib/useGenlayerWrite";
import { api, ApiError, type Bounty, type Testimony } from "@/lib/api";
import { isContractConfigured } from "@/lib/genlayer-client";

interface EvidenceEntry {
  kind: "image" | "document" | "video" | "url";
  url: string;
}

export default function SubmitTestimonyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: bountyId } = use(params);
  const router = useRouter();
  const { write, state, txHash, errorMessage, reset } = useGenlayerWrite();

  const [bounty, setBounty] = useState<Bounty | "loading" | "unreachable">("loading");
  const [statement, setStatement] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceEntry[]>([]);
  const [newEvidenceUrl, setNewEvidenceUrl] = useState("");
  const [newEvidenceKind, setNewEvidenceKind] = useState<EvidenceEntry["kind"]>("url");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Same reasoning as the create-bounty form: once the off-chain draft is
  // created, a retry after a failed/rejected on-chain call reuses it
  // instead of creating a duplicate testimony row every attempt.
  const [draftTestimony, setDraftTestimony] = useState<Testimony | null>(null);

  useEffect(() => {
    api
      .get<{ bounty: Bounty }>(`/bounties/${bountyId}`)
      .then((d) => setBounty(d.bounty))
      .catch(() => setBounty("unreachable"));
  }, [bountyId]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    setUploading(true);
    setFormError(null);
    try {
      const presign = await api.post<{ uploadUrl: string; apiKey: string; timestamp: number; signature: string; folder: string }>(
        "/uploads/presign",
      );
      const body = new FormData();
      body.append("file", file);
      body.append("api_key", presign.apiKey);
      body.append("timestamp", String(presign.timestamp));
      body.append("signature", presign.signature);
      body.append("folder", presign.folder);

      // Uploads directly to Cloudinary, not through our API — never sends
      // our API secret to the browser, only a signature valid for this one
      // upload (see apps/api/src/routes/uploads.ts).
      const res = await fetch(presign.uploadUrl, { method: "POST", body });
      if (!res.ok) throw new Error("Upload failed");
      const uploaded = (await res.json()) as { secure_url: string; resource_type: string };

      const kind: EvidenceEntry["kind"] =
        uploaded.resource_type === "video" ? "video" : uploaded.resource_type === "image" ? "image" : "document";
      setEvidence((list) => [...list, { kind, url: uploaded.secure_url }]);
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.status === 503
          ? "File upload isn't configured yet — paste an evidence URL below instead."
          : "File upload failed. You can still add evidence by pasting a URL below.",
      );
    } finally {
      setUploading(false);
    }
  }

  function addEvidence() {
    if (!newEvidenceUrl) return;
    try {
      new URL(newEvidenceUrl);
    } catch {
      setFormError("Evidence must be a valid URL.");
      return;
    }
    setEvidence((list) => [...list, { kind: newEvidenceKind, url: newEvidenceUrl }]);
    setNewEvidenceUrl("");
    setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submitOrRetry();
  }

  async function submitOrRetry() {
    setFormError(null);

    if (statement.trim().length < 20) {
      setFormError("Statement must be at least 20 characters.");
      return;
    }

    if (bounty === "loading" || bounty === "unreachable") {
      setFormError("Bounty details are still loading — try again in a moment.");
      return;
    }
    // The contract's own sequential id ("bounty:0", "bounty:1", ...) is what
    // submit_testimony needs — it has nothing to do with our internal
    // database UUID (the `bountyId` route param), which the contract has
    // never heard of. This is only ever set once the bounty's escrow
    // transaction has actually confirmed on-chain (chain-sync writes it).
    if (!bounty.chain_bounty_id) {
      setFormError(
        "This bounty's escrow hasn't been confirmed on-chain yet, so the contract doesn't have a record of it. Ask the creator to fund it first.",
      );
      return;
    }

    setSubmitting(true);
    try {
      const { testimony, statementHash } =
        draftTestimony !== null
          ? { testimony: draftTestimony, statementHash: draftTestimony.statement_hash }
          : await api.post<{ testimony: Testimony; statementHash: string }>("/testimonies", {
              bountyId,
              statement,
              isAnonymous,
              evidence: evidence.map((e) => ({ kind: e.kind, url: e.url })),
            });
      setDraftTestimony(testimony);

      // The contract only ever receives the statement hash + evidence URLs —
      // never the full statement text — keeping witness privacy off-chain
      // while still anchoring an immutable proof of exactly what was judged.
      const hashOnChain = keccak256(toBytes(statementHash));
      const result = await write({
        functionName: "submit_testimony",
        // evidence URLs are passed as a JSON-encoded string, not a native
        // array — GenVM's calldata schema only supports primitive
        // parameter types (str/int/bool) on public methods, matching the
        // contract's `evidence_urls_json: str` parameter. The first arg is
        // the contract's own bounty id, NOT our database UUID.
        args: [bounty.chain_bounty_id, hashOnChain, JSON.stringify(evidence.map((e) => e.url)), isAnonymous],
        // The contract requires gl.message.value to match bounty.witness_bond_wei
        // exactly (or be exactly 0 if no bond is required) — never a caller-chosen amount.
        value: BigInt(bounty.witness_bond_wei),
      });

      if (result) {
        await api.patch(`/testimonies/${testimony.id}/chain-sync`, { submitTxHash: result.txHash });
        router.push(`/bounties/${bountyId}`);
      }
      // If the on-chain submission failed/was rejected, stay on the page —
      // the off-chain testimony draft is saved, but we don't want to
      // navigate away and hide the failure the way create-bounty used to.
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && (err.body as { error?: string })?.error === "already_submitted") {
        setFormError(
          "This wallet has already submitted testimony for this bounty — each wallet can only testify once per bounty. Connect a different wallet to submit another account.",
        );
      } else {
        setFormError(err instanceof ApiError ? `Couldn't submit testimony (${err.status}).` : "Something went wrong.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <TopNav />
      <main className="flex-1 w-full max-w-2xl mx-auto p-4 md:p-12">
        <h1 className="text-3xl font-semibold text-text-primary mb-2">Submit Testimony</h1>
        <p className="text-text-secondary mb-8">
          Your account is corroborated against other testimony and evidence by the Intelligent Contract.
          Submit factual, first-hand observations.
        </p>

        {!isContractConfigured() && (
          <div className="mb-6 bg-tertiary/10 border border-tertiary/30 text-tertiary rounded-lg p-4 text-sm">
            The Intelligent Contract isn&apos;t deployed yet — your testimony will be saved, but on-chain
            anchoring isn&apos;t live until deployment completes.
          </div>
        )}

        {bounty !== "loading" && bounty !== "unreachable" && !bounty.chain_bounty_id && (
          <div className="mb-6 bg-tertiary/10 border border-tertiary/30 text-tertiary rounded-lg p-4 text-sm">
            This bounty&apos;s escrow hasn&apos;t confirmed on-chain yet — testimony can&apos;t be anchored to
            the contract until it has.
          </div>
        )}

        {bounty !== "loading" && bounty !== "unreachable" && bounty.witness_bond_wei !== "0" && (
          <div className="mb-6 bg-primary-container/10 border border-primary-container/30 text-primary rounded-lg p-4 text-sm">
            This bounty requires a witness bond of {(Number(bounty.witness_bond_wei) / 1e18).toLocaleString()} GEN,
            locked when you submit and refundable once the bounty resolves.
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">
              Your Statement
            </span>
            <textarea
              className="input min-h-40"
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              maxLength={8000}
              placeholder="Describe exactly what you witnessed, including when and where..."
              required
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-on-surface-variant">
            <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
            Submit anonymously (your wallet address is still recorded for payout, but hidden from public view)
          </label>

          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">Evidence</span>
            <label className="flex items-center gap-2">
              <span
                className={`inline-flex items-center justify-center gap-2 rounded font-mono text-xs tracking-wide px-4 py-2 bg-transparent border border-border-subtle text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer ${uploading ? "opacity-50 pointer-events-none" : ""}`}
              >
                {uploading ? "Uploading…" : "Upload a file"}
              </span>
              <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
              <span className="text-text-secondary text-xs">or paste a URL below</span>
            </label>
            <div className="flex gap-2">
              <select
                className="input"
                // The shared `.input { width: 100% }` rule (defined below,
                // in this page's own <style> tag) and Tailwind's `w-32`
                // utility have equal CSS specificity — since this page's
                // <style> block is injected later in the document, its
                // width:100% was silently winning over w-32, collapsing
                // the select to fill the flex row and squeezing the URL
                // input next to nothing. An inline style always wins
                // regardless of source order, so it's set here instead.
                style={{ width: "8rem", flexShrink: 0 }}
                value={newEvidenceKind}
                onChange={(e) => setNewEvidenceKind(e.target.value as EvidenceEntry["kind"])}
              >
                <option value="url">URL</option>
                <option value="image">Image</option>
                <option value="document">Document</option>
                <option value="video">Video</option>
              </select>
              <input
                className="input flex-1"
                style={{ minWidth: 0 }}
                placeholder="https://..."
                value={newEvidenceUrl}
                onChange={(e) => setNewEvidenceUrl(e.target.value)}
              />
              <Button type="button" variant="secondary" onClick={addEvidence}>
                Add
              </Button>
            </div>
            {evidence.length > 0 && (
              <ul className="flex flex-col gap-1 mt-1">
                {evidence.map((e, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between font-mono text-xs text-text-secondary bg-surface-elevated border border-border-subtle rounded px-3 py-2"
                  >
                    <span className="truncate">
                      [{e.kind}] {e.url}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEvidence((list) => list.filter((_, idx) => idx !== i))}
                      className="text-error ml-2"
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {formError && <p className="text-error text-sm">{formError}</p>}
          <TxLifecycle state={state} txHash={txHash} errorMessage={errorMessage} />

          {draftTestimony && ["rejected", "failed", "timeout"].includes(state) ? (
            <div className="flex flex-col gap-2">
              <p className="text-text-secondary text-sm">
                Your statement was saved, but the on-chain anchor didn&apos;t go through. Retry without
                re-entering anything.
              </p>
              <Button
                type="button"
                onClick={() => {
                  reset();
                  submitOrRetry();
                }}
                disabled={submitting}
              >
                {submitting ? "Retrying…" : "Retry On-Chain Submission"}
              </Button>
            </div>
          ) : (
            <Button type="submit" disabled={submitting} className="mt-2">
              {submitting ? "Submitting…" : "Submit Testimony"}
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
