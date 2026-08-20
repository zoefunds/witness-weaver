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

**Real contract + database E2E refund proof** (opt-in, Docker required):

```bash
# terminal 1
genlayer up --headless --reset-db --reset-validators --numValidators 1

# terminal 2
docker compose up -d postgres
DATABASE_URL=postgres://witnessweave:changeme@localhost:5432/witnessweave \
  npm run test:e2e:refund --workspace apps/api
```

`apps/api/test/genlayer-refund.e2e.test.ts` deploys the production
`WitnessWeave` contract to GenLayer localnet, funds fresh simulator accounts,
creates a bonded bounty and testimony, performs the terminal timeout path,
and executes `claim_bond_refund` from the witness account. It first asserts
the actual post-transaction `get_testimony` state (`bond_deposited == 0`,
`bond_claimed == true`) and only then calls the unmodified production
`syncBountyEvaluation` function, which reads the real contract and persists
the matching PostgreSQL state. No contract view or sync dependency is mocked.

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
- **No always-on database test service in CI yet.** The refund proof is a
  Docker-backed, opt-in test so it can deploy and execute a real local
  GenLayer contract plus Postgres without ever using a production wallet or
  database. A CI job that starts both services remains future work.
- **No React component tests.** The UI was verified visually against the
  deployed app rather than with component/unit tests, given the project's
  time constraints; this is the area with the least automated coverage.

## If you're picking this up next

The next highest-value test is a real localnet evaluation/settlement test:
it should exercise the non-deterministic evaluation round and assert the
resulting corroboration, reputation, and Truth Record writes. The refund E2E
test intentionally uses the deterministic timeout recovery path so it is
repeatable without an LLM service.
