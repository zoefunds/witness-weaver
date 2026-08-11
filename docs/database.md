# Database

PostgreSQL, migrated with `node-pg-migrate`. Schema lives in
`apps/api/src/db/migrations/1739200000000_init.ts`.

| Table | Purpose |
|---|---|
| `users` | Identity is the wallet address — nothing else required to sign in. |
| `bounties` | Off-chain mirror of an on-chain bounty; `chain_bounty_id` and `create_tx_hash` populated once the escrow tx confirms. |
| `testimonies` | Full statement text + `statement_hash` (the value anchored on-chain). |
| `evidence_files` | One row per evidence URL/upload, linked to a testimony. |
| `evaluations` | Tracks the on-chain `evaluate_bounty`/`settle` transaction lifecycle and caches the resulting verdict. |
| `truth_records` | The published, read-optimized mirror of a finalized bounty outcome — one per bounty (`unique` constraint). |
| `reputation_events` | Append-only ledger of signed bps deltas. Current score is *derived* at read time with recency decay, never mutated in place. |
| `notifications` | Per-user notification feed. |
| `tx_status_log` | Generic transaction-lifecycle tracker (`idle → preparing → wallet_check → requested → submitted → pending → confirmed/rejected/failed/timeout/backend_sync_failed`), referenced by subject type + id. |

## Migrations

```bash
cd apps/api
npm run migrate
```

Local development uses the Postgres container defined in the repo root's
`docker-compose.yml`:

```bash
docker compose up -d postgres
```

Production uses a dedicated Fly Postgres cluster (see
[`deployment.md`](./deployment.md)), not this compose file.
