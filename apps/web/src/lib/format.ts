import { formatEther } from "viem";

export function formatGen(wei: string | bigint): string {
  try {
    const value = Number(formatEther(BigInt(wei)));
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} GEN`;
  } catch {
    return "0 GEN";
  }
}

export function shortAddress(address: string, chars = 4): string {
  if (!address || address.length < chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function shortHash(hash: string, chars = 6): string {
  return shortAddress(hash, chars);
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
