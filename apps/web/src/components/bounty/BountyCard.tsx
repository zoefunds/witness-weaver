import Link from "next/link";
import type { Bounty } from "@/lib/api";
import { formatGen, timeAgo } from "@/lib/format";
import { StatusChip } from "@/components/ui/StatusChip";

export function BountyCard({ bounty }: { bounty: Bounty }) {
  return (
    <Link
      href={`/bounties/${bounty.id}`}
      className="block bg-surface-elevated border border-border-subtle rounded-lg p-5 hover:border-outline transition-colors group"
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary px-2 py-0.5 bg-surface-container rounded border border-border-subtle">
          {bounty.incident_type}
        </span>
        <StatusChip status={bounty.status} pulse={bounty.status === "evaluating"} />
      </div>
      <h3 className="text-lg font-medium text-text-primary mb-2 group-hover:text-primary transition-colors">
        {bounty.title}
      </h3>
      <p className="text-sm text-text-secondary line-clamp-2 mb-4">{bounty.description}</p>
      <div className="flex items-center justify-between border-t border-border-subtle/50 pt-3">
        <span className="font-mono text-xs text-text-secondary">{timeAgo(bounty.created_at)}</span>
        <span className="font-mono text-sm text-secondary">{formatGen(bounty.reward_wei)}</span>
      </div>
    </Link>
  );
}
