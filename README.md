# WitnessWeave

**Turn real-world testimony into a living truth layer.**

WitnessWeave is a decentralized testimony marketplace. Someone with a
real-world dispute (a damaged delivery, a service gone wrong, a
he-said/she-said with money on the line) opens a **Testimony Bounty** and
funds it with a GEN reward. Independent witnesses submit testimony and
evidence. Once the submission window closes, a **GenLayer Intelligent
Contract** — running non-deterministic LLM reasoning with live web/image
fetching, checked for agreement across multiple validators — reaches a
verifiable consensus verdict and settles the bounty on-chain, publishing
an immutable **Truth Record**.

No human moderator decides who's telling the truth. The contract does,
and every validator has to agree.

- **Live app:** https://witness-weave.vercel.app
- **API:** https://witnessweave-api.fly.dev
- **Chain:** GenLayer StudioNet (chain id `61999`)

## How it works

1. **Create a bounty** — describe the dispute, set a reward, a witness
   bond, a submission deadline, and an evaluation timeout, then fund the
   escrow on-chain.
2. **Witnesses submit testimony** — a statement plus evidence (photos,
   receipts, screenshots, links), hashed and anchored on-chain. One
   testimony per wallet per bounty.
3. **Deadline passes → automatic evaluation** — nobody has to click
   anything. A backend watcher polls for bounties whose submission
   deadline has passed on-chain (GenVM patches `datetime.now()` to a real,
   consensus-agreed block timestamp — not a fake virtual clock) and
   triggers `evaluate_bounty`, which is otherwise permissionless and can
   also be triggered manually by the bounty creator.
4. **The contract evaluates** — validators independently fetch the
   submitted evidence, run an LLM prompt scoring each testimony's
   consistency with the dispute and with each other, and must agree on
   the outcome (`gl.vm.run_nondet_unsafe`) before a verdict is accepted.
5. **Settlement** — once a settleable verdict exists, `settle` pays the
   reward out of escrow to corroborated witnesses per the verdict's payout
   split (or refunds the creator if no credible account emerges), and a
   **Truth Record** is published: an immutable, publicly viewable summary
   of the verdict, confidence score, and rationale.

Every write path is escrow-safe (funds zeroed before transfer, never the
reverse) and every evaluation/settlement/refund path is permissionless —
the backend watcher is not a privileged actor, it's just "anyone" running
on a schedule so bounties resolve even if nobody's watching in a browser.

## Structure

```
apps/web/          Next.js 16 frontend (Vercel)
apps/api/           Fastify 5 backend (Fly.io, 2 machines, always-on)
contracts/           The Intelligent Contract (GenLayer StudioNet)
docs/                 Architecture, database, wallet security, GenLayer, deployment, security, testing
video/                 Demo video production assets (storyboard, script, Remotion project)
MEMORY.md            Project decision log — read this first for *why*, not just *what*
```

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router, Webpack build — Turbopack disabled due to a custom webpack config), Tailwind, Reown AppKit + wagmi for wallet connect |
| Backend | Fastify 5, `node-pg-migrate`, `ioredis`-backed distributed rate limiting, WebSocket support |
| Database | PostgreSQL (Fly Postgres) — read-optimized mirror of on-chain state, never the source of truth |
| Chain | GenLayer StudioNet, `genlayer-js` SDK |
| Contract | Python, GenVM (`gl.Contract`), non-deterministic multi-validator consensus |
| Evidence storage | Cloudinary (signed direct-from-browser upload) |
| Auth | Sign-in-with-wallet (nonce + signature → JWT bearer token, no passwords, no custodial keys) |

## Local development

```bash
# 1. Database
docker compose up -d postgres

# 2. Backend
cd apps/api
cp .env.example .env
npm install
npm run migrate
npm run dev          # http://localhost:8080

# 3. Frontend (new terminal)
cd apps/web
cp .env.example .env.local
npm install
npm run dev           # http://localhost:3000
```

The contract itself is deployed separately, by hand, through GenLayer
Studio — see [`docs/genlayer.md`](docs/genlayer.md). Point
`GENLAYER_CONTRACT_ADDRESS` (backend) and
`NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS` (frontend) at whatever address you
deployed to.

## The Intelligent Contract

`contracts/witnessweave_contract.py` — a single `WitnessWeave(gl.Contract)`
class covering the full bounty lifecycle:

**Writes:** `create_bounty`, `cancel_bounty`, `submit_testimony`,
`evaluate_bounty`, `settle`, `claim_timeout_refund`, `claim_bond_refund`

**Views:** `get_bounty`, `get_testimony`, `get_bounty_testimonies`,
`get_contract_info`, `get_current_time`

All view methods return JSON-encoded strings (GenVM's calldata schema only
supports primitive types — `str`/`int`/`bool` — as public method
*parameters*; lists/dicts are fine as storage or return values, just not
inputs, and the frontend/backend both `JSON.parse` accordingly).

## Deployment

- **Frontend:** Vercel project `witness-weave`, deployed via `vercel deploy --prod`
- **Backend:** Fly.io app `witnessweave-api`, 2 machines in `iad`, `min_machines_running=1`, `auto_stop_machines=false` — genuinely always-on, not scale-to-zero
- **Database:** Fly Postgres app `witnessweave-db` (unmanaged, `shared-cpu-1x`/256MB — small enough that concurrent long-lived `fly postgres connect` sessions can starve it; keep debugging sessions short and scoped)

Full sequence in [`docs/deployment.md`](docs/deployment.md).

## Docs

- [`docs/architecture.md`](docs/architecture.md) — system overview, on-chain vs off-chain split
- [`docs/database.md`](docs/database.md) — schema
- [`docs/wallet-security.md`](docs/wallet-security.md) — auth model and threat model
- [`docs/genlayer.md`](docs/genlayer.md) — the Intelligent Contract, deployment steps
- [`docs/deployment.md`](docs/deployment.md) — full production deployment sequence
- [`docs/security.md`](docs/security.md) — security posture and known limitations
- [`docs/testing.md`](docs/testing.md) — test strategy
- [`MEMORY.md`](MEMORY.md) — architectural decisions and why they were made, including incidents and their root causes

## Status

Frontend, backend, database schema, and the Intelligent Contract are all
implemented and live on StudioNet. The full evaluate → settle → Truth
Record loop has been exercised end-to-end against real deployed bounties,
including automatic deadline-triggered evaluation with no user
interaction required.

Known gaps: no CI pipeline yet (tests are run manually before each
deploy), Sybil resistance is currently just wallet-cost + one-testimony-
per-bounty-per-wallet, and evidence URLs aren't scanned for malicious
content before being fetched by validators.
