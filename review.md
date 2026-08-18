# Review response — August 2026

## The review

> Thanks for the submission. Before this can receive project credit, persist
> the exact contract-generated bounty and testimony IDs instead of relying on
> transaction hashes or heuristic matching, then add an end-to-end test
> showing that testimony outcomes sync and witnesses can claim bond refunds.

This document records the response, the affected code, the safety properties
it establishes, and the deployment work. The contract continues to be the
source of truth; PostgreSQL is only a query-friendly mirror.

---

## 1. Persist exact contract-generated IDs

### Problem

`create_bounty` and `submit_testimony` both return the newly created
contract IDs (`bounty:<n>` and `testimony:<n>`). The application did not use
those return values consistently. In particular, bounty creation could scan
recent on-chain bounties and match a creator/title pair after a transaction
confirmed. That is heuristic matching: two concurrent creations can have the
same title and any inferred match can point the local draft at the wrong
escrow. Some local sync calls also stored the transaction hash without the
authoritative contract ID, leaving later outcome sync unable to find its
corresponding testimony reliably.

### Fix

`apps/web/src/lib/useGenlayerWrite.ts` now retains the finalized GenLayer
receipt and exports `contractReturnFromReceipt`.

- It accepts a return value only from **exactly one** leader receipt.
- It accepts only a string result (including JSON-encoded string results).
- It returns `undefined` for an absent, malformed, or ambiguous result.

The create and retry-fund flows use that exact return value for
`chain_bounty_id`:

- `apps/web/src/app/bounties/new/page.tsx`
- `apps/web/src/components/bounty/FundEscrowButton.tsx`

The testimony submit flow uses it for `chain_testimony_id`:

- `apps/web/src/app/bounties/[id]/submit/page.tsx`

The previous `resolveChainBountyId` title/creator scan has been removed from
`apps/web/src/lib/genlayer-client.ts`. Neither ID is now inferred from a
transaction hash, a title, a wallet, a sequence, or a nearby contract record.
If GenLayer does not expose the return value, the app leaves the database row
unlinked instead of guessing.

### Why this is safe

The only accepted identifier is the value the contract returned for that
finalized write. A transaction hash remains useful as an explorer/audit
reference, but it is not used to derive identity. This prevents a local
bounty or testimony from being connected to an unrelated concurrent chain
record.

### Automated check

`apps/web/src/lib/__tests__/genlayer-write.test.ts` proves that the receipt
parser accepts the direct `bounty:42` / `testimony:7` return values and
rejects missing or multi-receipt data rather than guessing an ID.

---

## 2. Mirror testimony outcomes and bond-refund state

### Problem

`syncBountyEvaluation` already read a bounty and its testimonies from the
contract to mirror evaluation outcomes. It did not mirror the contract's
`bond_deposited` or `bond_claimed` fields. Consequently, a witness could
claim a bond successfully on-chain while the dashboard continued to render a
claim button from stale PostgreSQL data.

### Fix

`apps/api/src/lib/sync-evaluation.ts` now reads and persists, in the same
database transaction as the outcome update:

- testimony status (`submitted`, `corroborated`, `disputed`, or `rejected`)
- `consistency_bps`
- `bond_deposited_wei`
- `bond_claimed`

The migration
`apps/api/src/db/migrations/1739900000000_testimony_bond_claimed.ts` adds the
non-null `testimonies.bond_claimed boolean default false` column.

`apps/web/src/components/bounty/ClaimBondRefundButton.tsx` invokes
`POST /bounties/:id/sync-evaluation` after a finalized `claim_bond_refund`
write, then refreshes the witness dashboard. The button disappears only once
the contract-derived mirror says the bond is claimed.

### End-to-end test

`apps/api/test/db-integration.test.ts` includes:

`E2E: contract testimony outcomes sync and a claimed witness bond is reflected`

It creates a temporary bounty and witness testimony in PostgreSQL, supplies
the same contract view snapshots the production sync reads, calls the
production `syncBountyEvaluation` function, and verifies two stages:

1. A terminal `RESOLVED` bounty with a `CORROBORATED` testimony writes
   `status = corroborated`, `consistency_bps = 8800`,
   `bond_deposited_wei = 25`, and `bond_claimed = false`.
2. A subsequent snapshot after `claim_bond_refund` writes
   `bond_deposited_wei = 0` and `bond_claimed = true`.

The test is opt-in because it writes then removes short-lived fixture data:

```bash
RUN_CHAIN_SYNC_E2E=1 npm test --workspace apps/api
```

Run it only with a dedicated/test `DATABASE_URL` and after applying the
migration.

---

## Deployment record

- Backend deployed to Fly.io app `witnessweave-api` (release version 23) and
  its `/health` endpoint returned `{"status":"ok","db":"up",...}`.
- The production database was migrated idempotently to add
  `testimonies.bond_claimed`.
- The first matching Vercel deployment revealed one remaining import in the
  retry-fund component. That component is now converted to the direct receipt
  return path too.
- `@base-org/account` was added to the frontend dependencies because the
  installed wagmi connector imports it during Vercel's Webpack build.
- The corrected frontend was redeployed successfully and is live at
  `https://witness-weave.vercel.app` (Vercel deployment
  `dpl_FFMikRL9mWGqSkMexieAniybjzHU`). The initial failed deployment did not
  replace the previous production alias.

## Validation performed

```bash
npm run build --workspace apps/api
npm test --workspace apps/api
npm test --workspace apps/web
git diff --check
```

All listed checks passed before deployment. The local default `next build`
command uses Turbopack and conflicts with the project's custom Webpack config;
Vercel correctly uses the configured `next build --webpack` command.
