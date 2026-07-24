import { expect, test } from "bun:test";

import { hasBoundaryOverride } from "./commands.ts";
import { toolDirectory } from "./directory.ts";

test("tracks a supported later cd before a GitHub command", () => {
  expect(toolDirectory({ command: "true && cd /tmp/../var && gh issue create" }, "/workspace"))
    .toBe("/var");
});

test("accepts quoted directories with spaces", () => {
  expect(toolDirectory({ command: "cd '/tmp/external checkout' && gh issue create" }, "/workspace"))
    .toBe("/tmp/external checkout");
});

test("normalizes explicit directories", () => {
  expect(toolDirectory({ cwd: "/tmp/../var" }, "/workspace")).toBe("/var");
});

test("fails closed for unsupported compound operators", () => {
  expect(toolDirectory({ command: "cd /tmp/external || cd /workspace && gh issue create" }, "/workspace"))
    .toEqual({ unresolved: true });
});

test("does not apply a directory change after the mutation", () => {
  expect(toolDirectory({ command: "gh issue create && cd /tmp/external" }, "/workspace")).toBeUndefined();
});

test("requires the explicit override on one command", () => {
  expect(hasBoundaryOverride("OMP_REPOSITORY_BOUNDARY_GUARD_ALLOW_EXTERNAL_MUTATION=1 gh issue create")).toBe(true);
  expect(hasBoundaryOverride("true && OMP_REPOSITORY_BOUNDARY_GUARD_ALLOW_EXTERNAL_MUTATION=1 gh issue create")).toBe(false);
  expect(hasBoundaryOverride("echo OMP_REPOSITORY_BOUNDARY_GUARD_ALLOW_EXTERNAL_MUTATION=1")).toBe(false);
});
