import { expect, test } from "bun:test";
import { rmSync } from "node:fs";

import {
  createGitHubWriteGuard,
  currentCheckoutRepository,
  guardDecision,
  loadPolicy,
  type GuardPolicy,
  type ToolCallHandler,
} from "./index.ts";

const current = "klondikemarlen/omp-github-write-guard";
const owned = "acme/example";
const external = "elsewhere/example";
const policy: GuardPolicy = {
  trustedOwners: ["acme"],
  allowOwnedIssueCreation: true,
  blockExternalPullRequests: true,
};

function githubOperation(op: string, repo: string) {
  return { path: "xd://github", content: JSON.stringify({ op, repo }) };
}

function hookHandler() {
  let handler: ToolCallHandler | undefined;
  createGitHubWriteGuard(policy)({
    on: (_event, registered) => {
      handler = registered;
    },
  });
  return handler!;
}

test("normalizes the plugin checkout origin", () => {
  expect(currentCheckoutRepository(process.cwd())).toBe(current);
});

test("defaults to confirmation without a trusted owner", () => {
  expect(guardDecision({ command: `gh issue create --repo ${external}` }, {}, current)).toMatchObject({
    allow: false,
    requiresConfirmation: true,
    target: external,
  });
  expect(guardDecision({ command: `gh pr create --repo ${external}` }, {}, current)).toMatchObject({
    allow: false,
    requiresConfirmation: true,
    target: external,
  });
});

test("fails closed for malformed local policy values", () => {
  const malformed = JSON.parse(
    '{"trustedOwners":["acme",42],"allowOwnedIssueCreation":"yes","blockExternalPullRequests":"yes"}',
  ) as GuardPolicy;

  expect(guardDecision({ command: `gh issue create --repo ${owned}` }, malformed, current)).toMatchObject({
    allow: false,
    requiresConfirmation: true,
    target: owned,
  });
});

test("loads explicit local policy files", async () => {
  const path = `/tmp/omp-github-write-guard-${crypto.randomUUID()}.json`;
  await Bun.write(path, JSON.stringify(policy));
  try {
    expect(loadPolicy(path)).toEqual(policy);
  } finally {
    rmSync(path);
  }
});

test("applies the configured ownership and creation matrix to CLI commands", () => {
  expect(guardDecision({ command: `gh issue create --repo ${owned}` }, policy, current)).toEqual({
    allow: true,
  });
  expect(guardDecision({ command: `gh pr create --repo ${owned}` }, policy, current)).toMatchObject({
    allow: false,
    action: "Create pull request",
    requiresConfirmation: true,
    target: owned,
  });
  expect(guardDecision({ command: `gh issue create --repo ${external}` }, policy, current)).toMatchObject({
    allow: false,
    action: "Create GitHub issue",
    requiresConfirmation: true,
    target: external,
  });
  expect(guardDecision({ command: `gh pr create --repo ${external}` }, policy, current)).toMatchObject({
    allow: false,
    action: "Create pull request",
    target: external,
  });
});

test("applies the configured ownership matrix to GitHub-tool operations", () => {
  expect(guardDecision(githubOperation("issue_create", owned), policy, current)).toEqual({ allow: true });
  expect(guardDecision(githubOperation("pr_create", owned), policy, current)).toMatchObject({
    allow: false,
    requiresConfirmation: true,
    target: owned,
  });
  expect(guardDecision(githubOperation("issue_create", external), policy, current)).toMatchObject({
    allow: false,
    requiresConfirmation: true,
    target: external,
  });
  expect(guardDecision(githubOperation("pr_create", external), policy, current)).toMatchObject({
    allow: false,
    target: external,
  });
});

test("keeps REST item writes confirmation-gated", () => {
  expect(
    guardDecision({ command: `gh api repos/${owned}/issues --raw-field title=probe` }, policy, current),
  ).toEqual({ allow: true });
  expect(
    guardDecision({ command: `gh api repos/${owned}/issues/42 --raw-field state=closed` }, policy, current),
  ).toMatchObject({ allow: false, action: "GitHub write", requiresConfirmation: true, target: owned });
});

test("requires confirmation before a force-with-lease push to another repository", () => {
  expect(
    guardDecision(
      { command: `git push --force-with-lease git@github.com:${external}.git HEAD` },
      policy,
      current,
    ),
  ).toMatchObject({ allow: false, requiresConfirmation: true, target: external });
});

test("shows the compact operation-and-target confirmation", async () => {
  let prompt = "";
  const result = await hookHandler()(
    { toolName: "bash", input: { command: `gh pr create --repo ${owned}` } },
    {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        confirm: (_title, message) => {
          prompt = message;
          return true;
        },
      },
    },
  );

  expect(result).toBeUndefined();
  expect(prompt).toBe(
    `Allow Create pull request targeting ${owned}? pull-request creation requires target-specific authorization.`,
  );
});

test("blocks denied pull requests without confirmation", async () => {
  let confirmations = 0;
  const result = await hookHandler()(
    { toolName: "github", input: { op: "pr_create", repo: external } },
    {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        confirm: () => {
          confirmations += 1;
          return true;
        },
      },
    },
  );

  expect(result).toMatchObject({ block: true, reason: expect.stringContaining(`targeting ${external}`) });
  expect(confirmations).toBe(0);
});
