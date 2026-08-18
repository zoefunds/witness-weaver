import { getAuthToken } from "./authToken";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    // Still sent for local dev convenience (same-site cookie works fine
    // there); the Authorization header below is what actually carries auth
    // in production, where the cookie is cross-site and unreliable.
    credentials: "include",
    headers: {
      // Fastify's default JSON body parser rejects an empty body outright
      // (FST_ERR_CTP_EMPTY_JSON_BODY) whenever Content-Type: application/json
      // is present — which every no-body POST here used to send
      // unconditionally, so every call with no payload (upload presign,
      // auth logout, and critically the client-side sync-evaluation call
      // fired right after a wallet-signed evaluate/settle tx confirms) was
      // silently 400ing. Only set it when there's an actual body to parse.
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) => request<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) => request<T>(path, { method: "PATCH", body: data ? JSON.stringify(data) : undefined }),
};

export interface Bounty {
  id: string;
  chain_bounty_id: string | null;
  contract_address: string | null;
  creator_id: string;
  title: string;
  description: string;
  incident_type: string;
  incident_occurred_at: string | null;
  location_context: string | null;
  evidence_requirements: string | null;
  witness_bond_wei: string;
  reward_wei: string;
  reward_deposited_wei: string;
  visibility: "public" | "unlisted";
  status: "draft" | "pending_escrow" | "open" | "evaluating" | "resolved" | "cancelled" | "timed_out";
  submission_deadline: string | null;
  created_at: string;
}

export interface Testimony {
  id: string;
  bounty_id: string;
  submitter_id: string;
  statement: string;
  statement_hash: string;
  is_anonymous: boolean;
  status: "submitted" | "under_review" | "corroborated" | "disputed" | "rejected";
  chain_testimony_id: string | null;
  bond_deposited_wei: string;
  bond_claimed: boolean;
  created_at: string;
  evidence?: { id: string; kind: string; url: string }[];
}

export interface Evaluation {
  id: string;
  bounty_id: string;
  status:
    | "idle"
    | "preparing"
    | "submitted"
    | "pending"
    | "confirmed"
    | "failed"
    | "timeout"
    | "needs_human_review";
  verdict: "passed" | "failed" | "partial_pass" | "needs_human_review" | null;
  confidence_bps: number | null;
  payout_bps: number | null;
  rationale: string | null;
  settle_tx_hash: string | null;
}

export interface TruthRecord {
  id: string;
  bounty_id: string;
  title: string;
  description: string;
  incident_type: string;
  verdict: string;
  confidence_bps: number;
  payout_bps: number | null;
  rationale: string;
  contract_address: string;
  final_state_root: string | null;
  settle_tx_hash: string | null;
  published_at: string;
}
