import { expect, test } from "bun:test";

import { guardDecision } from "./decision.ts";

test("allows writes to the invoking checkout", () => {
  expect(guardDecision({ action: "git push", target: "owner/repository" }, "owner/repository")).toEqual({ allow: true });
});

test("blocks unresolved and external targets", () => {
  expect(guardDecision({ action: "git push", targetUnresolved: true }, "owner/repository")).toMatchObject({
    allow: false,
    reason: expect.stringContaining("cannot be resolved"),
  });
  expect(guardDecision({ action: "git push", target: "elsewhere/example" }, "owner/repository")).toMatchObject({
    allow: false,
    reason: expect.stringContaining("differs"),
  });
});
