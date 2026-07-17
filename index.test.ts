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

test("only considers git push commands", () => {
  const handler = hookHandler();
  const context = { cwd: `/tmp/omp-github-write-guard-${crypto.randomUUID()}` };

  expect(guardDecision({ command: "gh issue create --repo elsewhere/example" }, current)).toEqual({
    allow: true,
  });
  expect(handler({ toolName: "github", input: { op: "issue_create", repo: external } }, context)).toBeUndefined();
  expect(handler({ toolName: "write", input: { path: "xd://github", content: "{}" } }, context)).toBeUndefined();
  expect(handler({ toolName: "bash", input: { command: "gh pr create --repo elsewhere/example" } }, context)).toBeUndefined();
});

test("allows pushes to the current repository", () => {
  expect(guardDecision({ command: "git push origin" }, current)).toEqual({ allow: true });
});

test("does not treat quoted git push text as a write", () => {
  const result = hookHandler()(
    { toolName: "bash", input: { command: 'git commit -m "mention git push"' } },
    { cwd: `/tmp/omp-github-write-guard-${crypto.randomUUID()}` },
  );

  expect(result).toBeUndefined();
});

test("hard-blocks resolved external targets synchronously", () => {
  const handler = hookHandler();
  const result = handler(
    {
      toolName: "bash",
      input: { command: ` git push --force-with-lease git@github.com:${external}.git HEAD` },
    },
    { cwd: process.cwd() },
  );

  expect(result).toEqual({
    block: true,
    reason: `Blocked git push targeting ${external}: the target differs from the current checkout (${current}).`,
  });
  expect(result).not.toBeInstanceOf(Promise);
});

test("hard-blocks unresolved checkouts and targets", () => {
  expect(guardDecision({ command: "git push origin" })).toEqual({
    allow: false,
    action: "git push",
    target: undefined,
    reason: "the current checkout has no resolvable GitHub origin repository",
  });
  expect(guardDecision({ command: "git push upstream" }, current)).toEqual({
    allow: false,
    action: "git push",
    target: undefined,
    reason: "the GitHub target cannot be resolved",
  });
});

test("resolves named push remotes", () => {
  const repository = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  mkdirSync(repository, { recursive: true });
  try {
    execFileSync("git", ["init", repository]);
    execFileSync("git", ["-C", repository, "remote", "add", "origin", `git@github.com:${current}.git`]);
    execFileSync("git", ["-C", repository, "remote", "add", "upstream", `git@github.com:${current}.git`]);
    execFileSync("git", ["-C", repository, "remote", "set-url", "--push", "upstream", `git@github.com:${external}.git`]);

    expect(
      hookHandler()(
        { toolName: "bash", input: { command: "git push --atomic upstream", cwd: repository } },
        { cwd: repository },
      ),
    ).toEqual({
      block: true,
      reason: `Blocked git push targeting ${external}: the target differs from the current checkout (${current}).`,
    });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("treats a git worktree as its origin repository", () => {
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
    expect(
      hookHandler()(
        { toolName: "bash", input: { command: "git push origin", cwd: worktree } },
        { cwd: worktree },
      ),
    ).toBeUndefined();
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});
