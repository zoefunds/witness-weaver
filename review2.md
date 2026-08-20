# Review response 2 — verified end-to-end witness bond refund

## Review requirement addressed

> The exact contract IDs are now persisted, but the requested end-to-end
> refund proof is still missing. The new test mocks every contract read and
> manually changes the refund snapshot instead of executing
> `claim_bond_refund` and syncing the resulting contract state.

This change replaces that inadequate test with a genuine GenLayer localnet
integration test. `review.md` remains unchanged.

## What changed

### 1. Removed the mocked refund proof

The previous database integration test supplied synthetic contract-view
objects and an injected reader to `syncBountyEvaluation`. It also changed a
local JavaScript refund flag. That path has been removed from:

- [`apps/api/test/db-integration.test.ts`](./apps/api/test/db-integration.test.ts)
- [`apps/api/src/lib/sync-evaluation.ts`](./apps/api/src/lib/sync-evaluation.ts)

`syncBountyEvaluation` now accepts only the local bounty ID and always uses
the production `readContractView` path. There is no reader injection, mocked
contract state, or manually altered refund snapshot in the replacement test.

### 2. Added a real contract + database E2E test

New file: [`apps/api/test/genlayer-refund.e2e.test.ts`](./apps/api/test/genlayer-refund.e2e.test.ts)

New opt-in command:

```bash
npm run test:e2e:refund --workspace apps/api
```

The test uses a Docker-backed GenLayer localnet, fresh funded accounts, an
isolated Postgres database, and the actual production contract source at
[`contracts/witnessweave_contract.py`](./contracts/witnessweave_contract.py).

### 3. Added explicit localnet test configuration

`GENLAYER_NETWORK=localnet` selects the localnet client only for this E2E
process. StudioNet remains the production default. The test points that normal
client at the contract it has just deployed; it does not replace the client or
intercept any reads.

## Exact verified workflow

The test performs the following sequence against real contract state:

1. Creates fresh creator and witness accounts and funds them via the
   simulator faucet.
2. Deploys the production WitnessWeave contract.
3. Sends payable `create_bounty` and obtains the exact `bounty:0`-style ID
   from the finalized consensus receipt.
4. Sends payable `submit_testimony` and obtains the exact
   `testimony:0`-style ID from its finalized consensus receipt.
5. Requires all finalized receipt return values to agree on the same exact
   ID before using it. This is contract-return data, not a transaction hash,
   event heuristic, or database lookup.
6. Persists those exact IDs in temporary Postgres mirror rows.
7. Calls the unmodified production `syncBountyEvaluation(bountyId)`. The
   normal contract reads populate `bond_deposited_wei = 25` and
   `bond_claimed = false`.
8. Waits for the contract's real evaluation timeout—without faking the clock
   or altering state—then sends `claim_timeout_refund`.
9. Sends the witness account's real `claim_bond_refund(testimonyId)` contract
   transaction.
10. Reads `get_testimony(testimonyId)` directly from the deployed contract
    before performing the second database sync, and asserts:

    ```text
    bond_deposited == "0"
    bond_claimed == true
    ```

11. Calls the same production sync again and asserts the mirrored row now
    contains `bond_deposited_wei = "0"` and `bond_claimed = true`. It also
    confirms the contract's terminal bounty state is synchronized as
    `timed_out`.
12. Removes only the temporary test rows and closes the test database pool.

The key proof is that the contract write occurs before the direct contract
read and before the second sync. No test code can manufacture the successful
refund state.

## Validation

The full localnet proof was executed successfully:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5434/witnessweave \
GENLAYER_RPC_URL=http://127.0.0.1:4100/api \
RUN_GENLAYER_REFUND_E2E=1 \
npm run test:e2e:refund --workspace apps/api
```

Result:

```text
✔ E2E: real claim_bond_refund changes contract state and production sync mirrors it
ℹ pass 1
ℹ fail 0
```

The same workspace also passed:

```bash
npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext \
  --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck \
  apps/api/test/genlayer-refund.e2e.test.ts
npm run build --workspace apps/api
npm test --workspace apps/api
git diff --check
```

The frontend has no runtime code change in this fix. The backend change is
safe for production because StudioNet remains the default network and the
localnet option is activated only by the E2E environment variable.
