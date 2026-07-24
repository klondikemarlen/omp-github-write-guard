import { expect, test } from "bun:test";

import { guardDecision } from "./decision.ts";

test("allows writes to the invoking checkout", () => {
  expect(guardDecision({ action: "git push", target: "owner/repository" }, "owner/repository")).toEqual({ allow: true });
});

test("allows unresolved targets and blocks only resolved external targets", () => {
  expect(guardDecision({ action: "git push", targetUnresolved: true }, "owner/repository")).toEqual({ allow: true });
  expect(guardDecision({ action: "git push" }, undefined)).toEqual({ allow: true });
  expect(guardDecision({ action: "git push", target: "elsewhere/example" }, "owner/repository")).toMatchObject({
    allow: false,
    reason: expect.stringContaining("differs"),
  });
});
