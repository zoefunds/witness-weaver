import { test } from "node:test";
import assert from "node:assert/strict";
import { formatGen, shortAddress, shortHash, formatBps } from "../format";

test("formatGen converts wei to a human GEN amount", () => {
  assert.equal(formatGen("10000000000000000000000"), "10,000 GEN");
  assert.equal(formatGen("0"), "0 GEN");
});

test("formatGen never throws on garbage input", () => {
  assert.equal(formatGen("not-a-number" as unknown as string), "0 GEN");
});

test("shortAddress truncates the middle of a long address", () => {
  assert.equal(shortAddress("0x6f0b4cE7a1872db132b2F6B7743deFb30eBa698a"), "0x6f0b...698a");
});

test("shortAddress leaves short strings alone", () => {
  assert.equal(shortAddress("0xabc"), "0xabc");
});

test("shortHash is shortAddress with a wider default window", () => {
  assert.equal(shortHash("bounty:0"), "bounty:0"); // shorter than the truncation threshold
});

test("formatBps renders basis points as a percentage", () => {
  assert.equal(formatBps(6500), "65.0%");
  assert.equal(formatBps(0), "0.0%");
});
