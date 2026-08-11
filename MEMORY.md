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

## Open / pending

- **Evidence file storage** — no R2/S3 provider wired up; evidence is
  URL-only today (`STORAGE_*` env vars are documented but unconfigured).
  Needs the user to provision a bucket and provide credentials — not
  something to fabricate.
- **Custom domain** — still on shared `*.vercel.app`, which triggered a
  MetaMask/Blockaid "malicious site" false positive earlier. Needs the
  user to purchase a domain (not an action to take autonomously).
- **No Sybil resistance beyond wallet-signature cost** — nothing stops one
  person submitting "independent" testimony from multiple wallets.
- **No content moderation** on testimony/bounty text, no malicious-URL
  scanning on evidence links. See `docs/security.md` for the full list.
- **No CI pipeline** — tests exist (`docs/testing.md`) but nothing runs
  them automatically on push yet.
