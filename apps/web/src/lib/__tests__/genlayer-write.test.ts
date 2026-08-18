import { test } from "node:test";
import assert from "node:assert/strict";
import { contractReturnFromReceipt } from "../useGenlayerWrite";

test("uses the exact contract return from the sole finalized leader receipt", () => {
  assert.equal(
    contractReturnFromReceipt({ consensus_data: { leader_receipt: [{ result: '"bounty:42"' }] } }),
    "bounty:42",
  );
  assert.equal(
    contractReturnFromReceipt({ consensus_data: { leader_receipt: [{ result: "testimony:7" }] } }),
    "testimony:7",
  );
});

test("never guesses an id from incomplete or ambiguous receipt data", () => {
  assert.equal(contractReturnFromReceipt({ consensus_data: { leader_receipt: [] } }), undefined);
  assert.equal(
    contractReturnFromReceipt({ consensus_data: { leader_receipt: [{ result: '"bounty:1"' }, { result: '"bounty:2"' }] } }),
    undefined,
  );
  assert.equal(contractReturnFromReceipt({ consensus_data: { leader_receipt: [{ result: "" }] } }), undefined);
});
