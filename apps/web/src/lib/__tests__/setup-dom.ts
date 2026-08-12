import { Window } from "happy-dom";

// Node's built-in test runner has no browser DOM by default — this patches
// one onto the global scope before any component test imports React, so
// @testing-library/react's render() has somewhere to mount into.
const win = new Window();
const g = globalThis as unknown as Record<string, unknown>;
// Some of these (e.g. `navigator`) are already defined as read-only
// getters by Node's own built-in Web API globals — redefine rather than
// assign so happy-dom's versions win inside these tests.
for (const [key, value] of Object.entries({
  window: win,
  document: win.document,
  navigator: win.navigator,
  HTMLElement: win.HTMLElement,
  customElements: win.customElements,
})) {
  Object.defineProperty(g, key, { value, writable: true, configurable: true });
}
