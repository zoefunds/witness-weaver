"use client";

export type TxState =
  | "idle"
  | "preparing"
  | "wallet_check"
  | "requested"
  | "submitted"
  | "pending"
  | "rate_limited"
  | "confirmed"
  | "rejected"
  | "failed"
  | "timeout"
  | "backend_sync_failed";

const STEP_LABELS: Record<TxState, string> = {
  idle: "Idle",
  preparing: "Preparing transaction",
  wallet_check: "Waiting for wallet",
  requested: "Transaction requested",
  submitted: "Submitted to StudioNet",
  pending: "Pending confirmation",
  rate_limited: "GenLayer network is busy — waiting to retry",
  confirmed: "Confirmed",
  rejected: "Rejected in wallet",
  failed: "Transaction failed",
  timeout: "Timed out",
  backend_sync_failed: "Synced on-chain, but our records failed to update — refresh to check",
};

const TERMINAL_ERROR: TxState[] = ["rejected", "failed", "timeout", "backend_sync_failed"];

/**
 * Renders the full on-chain transaction lifecycle so the UI never claims
 * success before a transaction is actually confirmed. Every state in the
 * WitnessWeave tx pipeline (idle -> preparing -> wallet check -> submitted
 * -> pending -> confirmed | rejected | failed | timeout | backend_sync_failed)
 * gets an explicit, honest label here.
 */
export function TxLifecycle({ state, txHash, errorMessage }: { state: TxState; txHash?: string; errorMessage?: string }) {
  if (state === "idle") return null;

  const isError = TERMINAL_ERROR.includes(state);
  const isDone = state === "confirmed";

  return (
    <div
      className={`rounded-lg border p-4 flex flex-col gap-2 font-mono text-xs ${
        isError
          ? "border-error/30 bg-error-container/10 text-error"
          : isDone
            ? "border-secondary/30 bg-secondary/10 text-secondary"
            : "border-tertiary/30 bg-tertiary/10 text-tertiary"
      }`}
    >
      <div className="flex items-center gap-2">
        {!isError && !isDone && <span className="w-2 h-2 rounded-full bg-current animate-pulse" />}
        <span>{STEP_LABELS[state]}</span>
      </div>
      {errorMessage && <span className="text-text-secondary normal-case tracking-normal">{errorMessage}</span>}
      {txHash && (
        <span className="text-text-secondary normal-case tracking-normal break-all">
          Tx: {txHash}
        </span>
      )}
    </div>
  );
}
