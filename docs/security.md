# Security Review

## Authentication

- Wallet-signature sign-in only (see [`wallet-security.md`](./wallet-security.md)) — no passwords, no custodial keys.
- Sessions are bearer JWTs (`SESSION_JWT_SECRET`), sent as `Authorization: Bearer <token>`, stored client-side in `localStorage`. **Tradeoff, stated plainly**: this is more XSS-exposed than an `httpOnly` cookie would be — a successful XSS injection could exfiltrate the token. It was chosen over a cookie because the frontend (Vercel) and backend (Fly.io) are different sites, and cross-site cookies are dropped by default third-party-cookie blocking in current browsers, which made cookie-based sessions non-functional in practice (this was a real bug found and fixed during development). Mitigation: strict CSP and avoiding `dangerouslySetInnerHTML`/unsanitized HTML anywhere in the frontend keeps XSS surface minimal; a future improvement would be a same-site custom-domain setup (`app.` / `api.` subdomains of one domain) that restores cookie viability.
- Nonces are single-use, expire after 5 minutes, and are stored in Postgres (not in-process memory) — required because the API runs multiple Fly.io machines with no session affinity; an in-memory nonce store was a real bug found during development (a nonce issued by one machine was invisible to another).

## Authorization

- Every write route checks `req.session` and, where relevant, ownership (`creator_id`, `submitter_id`) before mutating a row.
- The `/internal/reputation-events` endpoint (reputation.ts) is gated behind a shared secret header (`INTERNAL_API_SECRET`) rather than user auth — it's meant to be called only by the backend's own evaluation-sync logic, never directly by a client. (In practice, reputation events are now written directly from `evaluation-sync.ts`'s own DB transaction rather than through this HTTP route — the route remains as a documented internal seam, not the live path.)

## Smart contract

- Escrow follows the zero-ledger-then-transfer ordering on every payout path (`contracts/witnessweave_contract.py`) — reentrancy is structurally prevented, not just discouraged.
- `gl.message.value` is the only source of truth for deposited amounts; no method trusts a caller-supplied amount parameter for money.
- `run_nondet_unsafe` with independent leader/validator re-derivation prevents the "validator just checks JSON shape" failure mode explicitly called out as a rejection criterion.
- **Not yet built**: on-chain rate limiting or bond-slashing for bad-faith testimony beyond the corroboration score itself — a witness who submits knowingly false evidence loses no more than an honest-but-wrong witness does today (both just fail to corroborate). A stronger design would slash bonds specifically for evidence that fails an [EXTERNAL]-classified fetch (dead/fabricated URLs) versus evidence that's merely unconvincing.

## Input validation

- All API request bodies are validated with `zod` schemas before touching the database.
- Evidence URLs are validated as well-formed `http(s)` URLs client- and contract-side, but **no malicious-URL/phishing scanning is performed** — a witness could submit an evidence URL pointing to a phishing page, and the contract will faithfully fetch and describe it. This is an accepted gap for now; a production hardening pass should add URL reputation checking (e.g. Google Safe Browsing API) before a URL is stored or fetched.

## Known gaps (not yet built)

- **No file upload / evidence storage provider wired** — `STORAGE_*` env vars are documented but unconfigured; evidence is URL-only today.
- **No Sybil resistance beyond wallet cost** — nothing stops one person from submitting multiple "independent" testimonies from different wallets. Reputation decay over time is the only friction currently in place.
- **No content moderation** on testimony statement text or bounty descriptions.
- **Basic per-IP rate limiting only** (`@fastify/rate-limit`, 120 req/min) — a backstop against runaway scripts, not fine-grained per-endpoint abuse policy.
- **No automated dependency vulnerability scanning** configured in CI (there is no CI pipeline yet — see [`testing.md`](./testing.md)).

## Secrets

- No secret is ever committed — verified via `.gitignore` covering `.env*`.
- The heartbeat bot's private key (`HEARTBEAT_PRIVATE_KEY`) is a Fly.io secret, never in source. It has no special contract privileges beyond paying its own gas — the contract's `owner` field is recorded at deploy time but no method currently checks it, so compromising this key risks only its own GEN balance, never bounty escrow.
