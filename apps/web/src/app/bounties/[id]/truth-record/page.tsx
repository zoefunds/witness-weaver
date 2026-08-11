import { notFound, redirect } from "next/navigation";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

// Thin redirect: bounties link here by bounty id, but the canonical Truth
// Record page is keyed by the record's own id (a bounty can only ever have
// one, via the DB's unique constraint on truth_records.bounty_id).
export default async function BountyTruthRecordRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${API_BASE_URL}/bounties/${id}/truth-record`, { cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) notFound();
  const data = await res.json();
  redirect(`/truth-records/${data.truthRecordId}`);
}
