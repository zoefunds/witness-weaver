import "../../lib/__tests__/setup-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusChip } from "../ui/StatusChip";

test("StatusChip renders the status text with underscores replaced by spaces", () => {
  render(<StatusChip status="needs_human_review" />);
  assert.ok(screen.getByText("needs human review"));
  cleanup();
});

test("StatusChip renders known verdict statuses without throwing", () => {
  for (const status of ["passed", "failed", "partial_pass", "open", "resolved"]) {
    render(<StatusChip status={status} />);
    cleanup();
  }
});
