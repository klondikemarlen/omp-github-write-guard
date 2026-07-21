import { expect, test } from "bun:test";

import { executableIndex } from "./executable-index.ts";

test("skips environment assignments before a command", () => {
  expect(executableIndex(["GH_HOST=github.com", "TOKEN=value", "gh", "pr", "create"])).toBe(2);
});

test("preserves an unresolved command position", () => {
  expect(executableIndex([undefined, "gh"])).toBe(0);
});
