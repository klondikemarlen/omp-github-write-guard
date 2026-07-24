import { expect, test } from "bun:test";

import { githubTarget, isHelpRequest } from "./target.ts";

const current = "owner/current";
const external = "elsewhere/example";

test("keeps explicit repository options authoritative", () => {
  expect(githubTarget(["gh", "issue", "create", "--body", external, "--repo", current], 3)).toMatchObject({ target: current });
});

test("supports positional repository and GitHub URL targets", () => {
  expect(githubTarget(["gh", "issue", "create", external], 3)).toMatchObject({ target: external });
  expect(githubTarget(["gh", "issue", "create", "https://github.com/elsewhere/example/issues/1"], 3)).toMatchObject({ target: external });
});

test("does not infer repository-shaped payload values", () => {
  for (const flag of ["--body", "--comment", "--label", "--milestone", "--file", "--input", "--field", "--raw-field"]) {
    expect(githubTarget(["gh", "issue", "create", flag, external], 3)).toMatchObject({ target: undefined });
  }
});

test("ignores unlisted payload file values without losing positionals", () => {
  expect(githubTarget(["gh", "issue", "create", "--body-file", external], 3)).toMatchObject({ target: undefined, targetUnresolved: false });
  expect(githubTarget(["gh", "issue", "create", "--body-file=body.md", external], 3)).toMatchObject({ target: external, targetUnresolved: false });
});

test("fails closed for an ambiguous unknown option operand", () => {
  expect(githubTarget(["gh", "issue", "create", "--unknown", external], 3)).toMatchObject({ targetUnresolved: true });
});

test("recognizes non-mutating help and version flags", () => {
  expect(isHelpRequest(["gh", "issue", "create", "--help", "--repo", external], 3)).toBe(true);
  expect(isHelpRequest(["gh", "issue", "create", "--version"], 3)).toBe(true);
  expect(isHelpRequest(["gh", "issue", "create", "--title", "--help"], 3)).toBe(false);
});

test("includes bounded issue details in the target description", () => {
  expect(githubTarget(["gh", "issue", "create", "--title", "A", "--body", "B"], 3, "Issue title")).toMatchObject({
    description: "Issue title: A\nBody: B",
  });
});
