const STYLES: Record<string, string> = {
  corroborated: "text-secondary bg-secondary/10 border-secondary/30",
  passed: "text-secondary bg-secondary/10 border-secondary/30",
  open: "text-secondary bg-secondary/10 border-secondary/30",
  disputed: "text-tertiary bg-tertiary/10 border-tertiary/30",
  partial_pass: "text-tertiary bg-tertiary/10 border-tertiary/30",
  needs_human_review: "text-tertiary bg-tertiary/10 border-tertiary/30",
  evaluating: "text-tertiary bg-tertiary/10 border-tertiary/30",
  rejected: "text-error bg-error/10 border-error/30",
  failed: "text-error bg-error/10 border-error/30",
  cancelled: "text-error bg-error/10 border-error/30",
  timed_out: "text-error bg-error/10 border-error/30",
  submitted: "text-status-unresolved bg-status-unresolved/10 border-status-unresolved/30",
  under_review: "text-status-unresolved bg-status-unresolved/10 border-status-unresolved/30",
  draft: "text-status-unresolved bg-status-unresolved/10 border-status-unresolved/30",
  pending_escrow: "text-status-unresolved bg-status-unresolved/10 border-status-unresolved/30",
  resolved: "text-secondary bg-secondary/10 border-secondary/30",
};

export function StatusChip({ status, pulse = false }: { status: string; pulse?: boolean }) {
  const style = STYLES[status] ?? STYLES.submitted;
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${style} ${pulse ? "truth-border-pulse" : ""}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
