# WitnessWeave — Project Memory / Decision Log

This file is the durable, human-readable record of architectural decisions for
WitnessWeave. Update it whenever a decision is made or changed — do not rely
on chat history to reconstruct "why" later.

## Product

WitnessWeave — a decentralized testimony/evidence marketplace. Users open a
**Testimony Bounty** describing a real-world dispute/incident. Independent
witnesses submit testimony + evidence (text, images, URLs). A GenLayer
Intelligent Contract evaluates credibility/corroboration using non-deterministic
LLM reasoning plus real web/image fetching, reaches validator consensus, and
pays out the GEN bounty from escrow. The result is published as an immutable
**Truth Record** — explicitly framed as a *credible consensus*, not objective
truth.

## Locked architecture decisions

- **Backend stack**: PostgreSQL running in Docker, self-hosted (not
  Firebase/Supabase). Decided 2026-08-11.
- **Backend hosting**: Fly.io. Must run 24/7 — `auto_stop_machines = false`,
  `min_machines_running = 1`, health-check-based restarts. Decided 2026-08-11.
- **Auth**: External wallet connect only (GenLayer-compatible wallet via
  `genlayer-js`). No custodial key generation/storage — avoids the private-key
  custody threat model entirely. Decided 2026-08-11.
- **Socials**: Dropped. No OAuth social-connection feature in v1. Decided
  2026-08-11 (superseded an earlier plan to require OAuth-verified social
  linking to prevent impersonation — descoped instead of built).
- **Frontend hosting**: Vercel.
- **Blockchain target**: GenLayer Studio / StudioNet, GEN token, one
  production Intelligent Contract (not several).
- **Design system**: Ported from user-supplied dark-theme prototypes
  (`stitch_dark_theme_design_concept/` — landingpage.html, bounty_details.html,
  final_truth_record.html, DESIGN.md). Not copy-pasted; re-implemented as the
  actual product UI. "Technical Minimalism with Glassmorphic Depth" — deep
  true-black base, Indigo primary, Verification Green for corroborated,
  Dispute Amber for contested, JetBrains Mono for all technical metadata.

## Contract design decisions

- Reference implementations studied on this machine: `~/ic6`
  (`testimony_aggregator/contract.py` — reputation/testimony aggregator with
  GEN escrow) and `~/Meme-olympics` (`contracts/meme_olympics.py` — image/vision
  judging with a custom validator).
- **Escrow pattern** (from ic6): every payable method reads only
  `gl.message.value` (never a caller-supplied amount). Two ledger fields per
  record — `*_wei` (agreed term) vs `*_deposited` (actual custody). Every
  payout path zeroes the deposited field, persists state, **then** calls the
  single `_send_gen` emission helper (`gl.evm.contract_interface` +
  `emit_transfer`). This ordering makes double-spend/reentrancy structurally
  impossible.
- **Consensus pattern** (from Meme-olympics, chosen over ic6's
  `eq_principle.prompt_comparative` because the review team explicitly warned
  against validators that "only check output format"): use
  `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` where `validator_fn`
  independently re-fetches evidence and re-runs the LLM judgment, then checks
  **numeric-tolerance gates** on the actual outcome (score deltas, per-criterion
  deltas, disqualification gates) — not JSON validity. Tolerances are named
  constants, not magic numbers, and are deliberately not too strict, to avoid
  spurious leader rotation / UNDETERMINED status.
- **Web/image fetch**: `gl.nondet.web.get(url)` for raw bytes,
  `gl.nondet.web.render(url, mode="text")` for text corroboration,
  `gl.nondet.exec_prompt(prompt, images=[bytes], response_format="json")` for
  genuine multimodal judgment (images list, not the singular `image=` kwarg —
  confirmed the singular form is a silent no-op in the pinned runtime).
- Contract deployment: **the user deploys the contract themselves** via
  GenLayer Studio and provides the deployed contract address back — the
  assistant does not deploy it or invent an address.

## Contract deployment gotcha (fixed 2026-08-11)

Hit a real "could not load contract schema" error on first deploy attempt.
Root cause: **GenVM's calldata schema generator only supports primitive
parameter types (`str` / `int` / `bool`) on `@gl.public.write`/`@gl.public.view`
methods** — `list`, `dict`, and `u256` are safe as storage/internal types
and as *return* types, but not as incoming parameter types. Confirmed by
re-checking both reference contracts (`~/ic6`, `~/Meme-olympics`): neither
ever declares a public method parameter typed `list`, `dict`, or `u256` —
money-shaped values go in as plain `int` and get wrapped in `u256(...)`
internally, and list-shaped values go in as a JSON-encoded `str` and get
`json.loads`'d internally. Also: default parameter values on public methods
must be simple literals, not references to module-level constant
expressions.

Fixed in `contracts/witnessweave_contract.py`: `create_bounty`'s
`witness_bond_wei`/`submission_window_epochs`/`evaluation_timeout_epochs`
changed from `u256` to `int` (with literal defaults `20`/`40`), and
`submit_testimony`'s `evidence_urls: list` changed to `evidence_urls_json: str`
parsed with `json.loads` inside the method. Frontend call sites
(`apps/web/src/app/bounties/new/page.tsx`,
`apps/web/src/app/bounties/[id]/submit/page.tsx`) updated to match — evidence
URLs are sent as `JSON.stringify(...)`, epoch window args as plain numbers.
Re-verified with `genvm-lint check` (both `lint.ok` and `validate.ok: true`,
13 methods detected) after the fix.

## Evaluate/settle flow, heartbeat clock, reputation, Truth Records (2026-08-11)

Closed the loop from "testimony submitted" to "bounty resolved":

- **Heartbeat automation**: the contract's virtual epoch clock only
  advances when someone calls its permissionless `heartbeat()` — nothing
  was calling it, so deadlines never arrived. Added
  `apps/api/src/lib/heartbeat.ts`: a `setInterval` loop inside the
  always-on API process, using a dedicated backend-owned wallet
  (`HEARTBEAT_PRIVATE_KEY` Fly secret) that calls `heartbeat()` every 2
  minutes. This wallet has no contract privileges (the contract's `owner`
  field is never checked by any method) — compromising it risks only its
  own GEN gas balance, never escrow. Verified live: `current_epoch` moved
  from 0 to 3 within a few minutes of deploy.
- **Evaluate/Settle UI** (`EvaluationPanel.tsx`): triggers `evaluate_bounty`
  (a real nondet multi-validator round — given a longer poll window than
  normal writes, ~5 min) then `settle`, from the bounty detail page.
- **`POST /bounties/:id/sync-evaluation`** (`evaluation-sync.ts`): the
  piece that makes the rest of the app reflect on-chain outcomes without a
  separate polling job. Reads the bounty + all its testimonies straight
  from the contract, mirrors status/verdict/corroboration into Postgres,
  and — the first time a bounty reaches RESOLVED — writes reputation
  events (once, guarded by an existence check) and publishes the Truth
  Record (once). Called by the frontend right after each write confirms.
- **Witness bond**: `submit_testimony`'s `value` was hardcoded to 0;
  now reads `bounty.witness_bond_wei` since the submit page already loads
  the bounty to get `chain_bounty_id`.
- **Reputation deltas** are named constants in `evaluation-sync.ts`
  (corroborated +600bps, disputed -300bps, rejected -800bps on the same
  0-10000 scale `reputation.ts`'s decay math uses) — deliberately not
  symmetric, since a good-faith-but-unconvincing account shouldn't be
  punished as hard as a rejected one.
- **Rate limiting**: `@fastify/rate-limit`, 120 req/min per IP, global
  backstop — not fine-grained per-endpoint policy. Real Sybil resistance
  is still just wallet-signature cost, not this.
- **Tests**: first automated coverage in the project — `apps/api/test/`
  (session/JWT logic) and `apps/web/src/lib/__tests__/` (formatting
  helpers), both via Node's built-in test runner. Documented what's
  covered and what isn't (mainly: no live-contract integration tests, no
  DB-backed API tests, no component tests) in `docs/testing.md`.

## Incident: a discarded random key, not the user's actual key (2026-08-11)

While setting up the heartbeat wallet, three `node -e "... KEY=0x..."`
invocations passed the private key as a **trailing shell argument**, not
an actual env var (`process.env.HEARTBEAT_KEY` was `undefined` each time).
`createAccount(undefined)` silently falls back to generating a **random**
key rather than erroring — so three different, never-saved addresses were
shown across the session, and the user sent real GEN to one of them
(`0x22B14439...`) before the bug was caught. That GEN is likely
unrecoverable — the private key was never persisted anywhere, only
generated and discarded in-process. **Lesson: always verify env vars
actually landed (e.g. `echo $VAR` or print `process.env.X` before using
it) when a command's behavior silently degrades instead of erroring on
missing input — especially before showing the user an address to send
real funds to.** The user's actual key was later verified correctly
(properly setting the env var) to derive `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`,
which is also the contract's `owner` address from deployment — confirmed
and proceeded with per the user's instruction, now funded and running as
the heartbeat wallet.

## Second contract redeploy + backlog cleanup (2026-08-12)

- **Contract fix**: `evaluate_bounty` rolled back entirely on a single bad
  image evidence link (`[LLM_ERROR] exec_prompt failed: INVALID_IMAGE`,
  observed live against a `picsum.photos` fetch) — contradicted the
  contract's own stated design principle that one bad link shouldn't block
  resolution. Fixed with a text-only retry fallback before treating it as a
  genuine LLM failure. Redeployed at
  `0x87284Ed4E8617B05fBbfe5B7313a91Ac0e7b7047` — **a fresh instance, not an
  upgrade**; bounties created against the prior address
  (`0xC474415Dd9Fb8B307eDB8384c1F897555C919BbB`) are now permanently
  orphaned relative to whichever address the app points at. Added
  `bounties.contract_address` (set once at chain-sync) so the UI can detect
  and flag this instead of silently failing reads/writes against the wrong
  contract.
- **Create-bounty deadline fields**: `submission_window_epochs`/
  `evaluation_timeout_epochs` were hardcoded (20/40) with no way to change
  them — now exposed as form fields with the same bounds the contract
  enforces.
- **Evidence storage**: switched from the originally planned Cloudflare
  R2/S3 to **Cloudinary** (user's choice, R2 activation issues) —
  signed-upload flow (`POST /uploads/presign`), API secret never reaches
  the browser.
- **Sybil baseline**: one testimony per (bounty, submitter), enforced at
  the DB level (`testimonies_unique_bounty_submitter`), not just app-level
  — closes the race window a pre-insert check alone would leave.
- **`claim_timeout_refund`/`claim_bond_refund` UI**: previously contract-only,
  no frontend action — now on the bounty page and My Testimonies
  respectively. Both let the contract itself reject with the real error if
  called too early, rather than the UI trying to predict on-chain epoch
  timing.
- **Notifications**: wired end-to-end (testimony-submitted → creator,
  bounty-resolved → creator + every witness), plus a bell dropdown in
  `TopNav`, polling every 30s (not a websocket — informational, not
  latency-sensitive).
- **Redis-backed rate limiting**: `@fastify/rate-limit`'s default store is
  per-process — with 2 Fly.io machines that silently doubled the real
  ceiling. Now backed by Upstash Redis (`REDIS_URL`) when configured, so
  the limit is actually global across machines. Falls back to in-memory if
  unset.
- **Tests**: added DB-integration tests (`apps/api/test/db-integration.test.ts`)
  that run against a real Postgres — every test wraps its inserts in a
  transaction that's always rolled back, so it's safe to run against
  production directly (and was, to prove it works: 7/7 passing against the
  live DB via the Fly proxy tunnel). Added component tests
  (`apps/web/src/components/__tests__/`) using `@testing-library/react` +
  `happy-dom` patched onto Node's test runner (no vitest/jest needed).

## Open / pending

- **Custom domain** — still on shared `*.vercel.app`, which triggered a
  MetaMask/Blockaid "malicious site" false positive earlier. Needs the
  user to purchase a domain (not an action to take autonomously).
- **No Sybil resistance beyond wallet-signature cost + one-testimony-per-bounty**
  — nothing stops rotating wallets entirely.
- **No content moderation** on testimony/bounty text, no malicious-URL
  scanning on evidence links. See `docs/security.md` for the full list.
- **No CI pipeline** — tests exist (`docs/testing.md`) but nothing runs
  them automatically on push yet.
- **Orphaned pre-redeploy bounty** (`b1e2baf3-...`, DB row still present)
  points at the old contract address; its escrowed GEN is unreachable
  through this app now. Flagged in the UI via the stale-contract banner,
  not yet cleaned up in the DB.
