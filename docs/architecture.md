# Architecture

```
                    ┌─────────────────┐
                    │      User        │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │     Vercel       │
                    │  apps/web (Next) │
                    └────────┬────────┘
                             │
                 ┌───────────┴────────────┐
                 │                        │
                 ▼                        ▼
        ┌─────────────────┐      ┌──────────────────────┐
        │   Fly.io API     │      │  GenLayer StudioNet   │
        │   apps/api        │      │  witnessweave_contract│
        │  (always-on)      │      │  (user-deployed)      │
        └────────┬────────┘      └──────────┬────────────┘
                 │                            │
                 ▼                            │
        ┌─────────────────┐                  │
        │  Fly Postgres    │◄─────────────────┘
        │  (off-chain mirror + tx-status log)
        └─────────────────┘
```

## On-chain vs off-chain

**On-chain (the Intelligent Contract):** bounty escrow, testimony
references (statement hash + evidence URLs, never full text), the
evaluation itself, settlement, and the resulting Truth Record fields
(verdict, confidence, rationale, corroboration).

**Off-chain (Postgres via apps/api):** user accounts (wallet-address-keyed),
full testimony text, evidence file metadata, reputation event ledger,
notifications, and a generic transaction-status log so the frontend can
show real lifecycle state (idle → preparing → wallet check → submitted →
pending → confirmed/failed/timeout) across reloads and devices.

The frontend talks to both directly: it calls `apps/api` for everything
off-chain, and calls the Intelligent Contract directly via `genlayer-js`
(signed by the user's own connected wallet) for every state-changing
on-chain action. The backend never holds a private key and never signs a
transaction on the user's behalf — it only mirrors state after the fact via
`chain-sync` endpoints the frontend calls once a transaction confirms.

## Why a backend exists at all, given the contract does the real work

Full testimony text and evidence files are privacy- and cost-sensitive —
they don't belong on a public ledger. The backend also gives the frontend
something to render immediately (draft state, tx-status history) without
waiting on a chain read, and computes reputation with recency decay, which
would be needlessly expensive to maintain fully on-chain for a value that's
advisory context for evaluation rather than escrowed money.

See [`database.md`](./database.md) for the schema and
[`genlayer.md`](./genlayer.md) for the contract.
