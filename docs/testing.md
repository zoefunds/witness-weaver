# Testing

## What's covered

**Backend** (`apps/api/test/`, Node's built-in test runner):
```bash
cd apps/api && npm test
```
Covers the wallet sign-in message format and JWT session issuing/verification
(including rejecting a tampered token) — the security-critical logic that,
if broken, breaks authentication silently rather than loudly.

**Frontend** (`apps/web/src/lib/__tests__/`):
```bash
cd apps/web && npm test
```
Covers the pure formatting helpers (`formatGen`, `shortAddress`, `formatBps`)
used throughout the UI to render on-chain values — these are exactly the
kind of function that's easy to get subtly wrong (off-by-one on decimals,
wrong truncation) and hard to notice wrong in a manual click-through.

**Type checking** (both apps): `npx tsc --noEmit` — run before every deploy
in this project's actual workflow, and it has caught real bugs (e.g.
BigInt-literal target mismatches).

**Contract**: `genvm-lint check contracts/witnessweave_contract.py --json`
validates the contract compiles and its schema loads correctly — this is
what would have caught the "could not load contract schema" class of bug
before deployment, and is documented in `docs/genlayer.md`.

## What's NOT covered, and why

- **No integration tests against a real GenLayer StudioNet contract.**
  Every bug found and fixed during this project's development (account
  shape, CORS on RPC calls, bounty-id mismatches, CORS on PATCH routes) was
  found by manually exercising the deployed app end-to-end, because there's
  no practical way to run GenVM's actual multi-validator consensus in a
  fast, deterministic CI test — it involves real network calls, a real LLM,
  and real wallet signatures. The honest testing strategy for this class of
  bug is careful manual verification against StudioNet before and after
  every deploy, which is what actually happened here.
- **No database-backed API integration tests.** The route handlers are
  thin (parse → query → respond) and were verified manually via `curl`
  against the live database during development; a proper test suite would
  spin up a disposable Postgres instance per test run (e.g. via
  `pg-mem` or a Docker Compose test service) — not yet built.
- **No React component tests.** The UI was verified visually against the
  deployed app rather than with component/unit tests, given the project's
  time constraints; this is the area with the least automated coverage.

## If you're picking this up next

The highest-value next test to add is a Postgres-backed integration test
for `/bounties/:id/sync-evaluation` (`apps/api/src/routes/evaluation-sync.ts`)
— it's the most complex single piece of business logic in the backend
(mapping on-chain state to DB rows, writing reputation events exactly once,
publishing the Truth Record exactly once) and currently has zero automated
coverage.
