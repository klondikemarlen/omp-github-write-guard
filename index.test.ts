import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

import {
  createGitHubWriteGuard,
  currentCheckoutRepository,
  guardDecision,
  type ToolCallHandler,
} from "./index.ts";

const current = "klondikemarlen/omp-github-write-guard";
const external = "elsewhere/example";

function githubOperation(op: string, repo?: string) {
  return { path: "xd://github", content: JSON.stringify({ op, ...(repo && { repo }) }) };
}

function hookHandler() {
  let handler: ToolCallHandler | undefined;
  createGitHubWriteGuard()({
    on: (_event, registered) => {
      handler = registered;
    },
  });
  return handler!;
}

test("normalizes the checkout origin", () => {
  expect(currentCheckoutRepository(process.cwd())).toBe(current);
});

test("allows writes to the current repository", () => {
  expect(guardDecision({ command: "gh issue create" }, current)).toEqual({ allow: true });
  expect(guardDecision(githubOperation("pr_create"), current)).toEqual({ allow: true });
  expect(guardDecision({ command: `gh issue close 1 --repo ${current}` }, current)).toEqual({
    allow: true,
  });
  expect(guardDecision({ command: "git push origin" }, current)).toEqual({ allow: true });
});

test("does not prompt writes to the current repository", async () => {
  let confirmations = 0;
  const result = await hookHandler()(
    { toolName: "github", input: { op: "issue_create" } },
    { cwd: process.cwd(), hasUI: true, ui: { confirm: () => ++confirmations > 0 } },
  );

  expect(result).toBeUndefined();
  expect(confirmations).toBe(0);
});

test("requires confirmation for resolved external repositories", () => {
  expect(guardDecision({ command: `gh pr create --repo ${external}` }, current)).toMatchObject({
    allow: false,
    action: "Create pull request",
    target: external,
    requiresConfirmation: true,
  });
  expect(guardDecision(githubOperation("issue_create", external), current)).toMatchObject({
    allow: false,
    action: "Create GitHub issue",
    target: external,
    requiresConfirmation: true,
  });
  expect(guardDecision({ command: `gh issue close 1 --repo ${external}` }, current)).toMatchObject({
    allow: false,
    action: "GitHub write",
    target: external,
    requiresConfirmation: true,
  });
  expect(
    guardDecision({ command: `git push --force-with-lease git@github.com:${external}.git HEAD` }, current),
  ).toMatchObject({ allow: false, action: "git push", target: external, requiresConfirmation: true });
});

test("uses the command working directory as the default target", () => {
  expect(guardDecision({ command: "gh issue create" }, current, external)).toMatchObject({
    allow: false,
    target: external,
    requiresConfirmation: true,
  });
});

test("blocks writes with an unresolved checkout or target", () => {
  expect(guardDecision({ command: "gh issue create" })).toMatchObject({
    allow: false,
    reason: "the current checkout has no resolvable GitHub origin repository",
  });
  expect(guardDecision({ command: 'gh pr create --repo ""' }, current)).toMatchObject({
    allow: false,
    reason: "the GitHub target cannot be resolved",
  });
  expect(guardDecision(githubOperation("repo_fork", current), current)).toMatchObject({
    allow: false,
    reason: "the GitHub target cannot be resolved",
  });
});

test("confirms every external write individually", async () => {
  let confirmations = 0;
  let prompt = "";
  const handler = hookHandler();
  const context = {
    cwd: process.cwd(),
    hasUI: true,
    ui: {
      confirm: (_title: string, message: string) => {
        confirmations++;
        prompt = message;
        return true;
      },
    },
  };

  expect(await handler({ toolName: "bash", input: { command: `gh pr create --repo ${external}` } }, context)).toBeUndefined();
  expect(await handler({ toolName: "bash", input: { command: `gh pr create --repo ${external}` } }, context)).toBeUndefined();

  expect(confirmations).toBe(2);
  expect(prompt).toBe(
    `You are in ${current}. Create pull request will write to ${external}. ` +
      "Choose an option because this is a different project.",
  );
});

test("blocks external writes without an interactive approval", async () => {
  const result = await hookHandler()(
    { toolName: "github", input: { op: "pr_create", repo: external } },
    { cwd: process.cwd(), hasUI: false, ui: { confirm: () => true } },
  );

  expect(result).toMatchObject({ block: true });
});

test("treats a git worktree as its origin repository", async () => {
  const repository = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  const worktree = `${repository}-worktree`;
  mkdirSync(repository, { recursive: true });
  try {
    execFileSync("git", ["init", repository]);
    execFileSync("git", ["-C", repository, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", repository, "config", "user.name", "Test"]);
    execFileSync("git", ["-C", repository, "remote", "add", "origin", "git@github.com:acme/example.git"]);
    execFileSync("git", ["-C", repository, "commit", "--allow-empty", "-m", "initial"]);
    execFileSync("git", ["-C", repository, "worktree", "add", worktree, "-b", "feature"]);

    expect(currentCheckoutRepository(worktree)).toBe("acme/example");
    let confirmations = 0;
    const result = await hookHandler()(
      { toolName: "bash", input: { command: "gh pr create", cwd: worktree } },
      { cwd: worktree, hasUI: true, ui: { confirm: () => ++confirmations > 0 } },
    );
    expect(result).toBeUndefined();
    expect(confirmations).toBe(0);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});
