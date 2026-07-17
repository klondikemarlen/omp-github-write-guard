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
const approvalInstructions =
  " Use authorized_git_push with an explicit remote and refspecs to request standard OMP approval.";

type AuthorizedGitPush = {
  approval: { tier: "exec"; override: true; reason: string };
  formatApprovalDetails(params: { remote: string; refspecs?: string[]; cwd?: string }): string[];
  execute(
    toolCallId: string,
    params: { remote: string; refspecs?: string[]; cwd?: string },
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: { cwd: string },
  ): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }>;
};

function createGuard(
  exec = async () => ({ code: 0, stdout: "", stderr: "" }),
) {
  let handler: ToolCallHandler | undefined;
  let authorizedGitPush: AuthorizedGitPush | undefined;
  const schema = {
    describe: () => schema,
    optional: () => schema,
  };
  createGitHubWriteGuard()({
    on: (_event, registered) => {
      handler = registered;
    },
    registerTool: (tool) => {
      authorizedGitPush = tool;
    },
    zod: {
      string: () => schema,
      array: () => schema,
      object: () => schema,
    },
    exec,
  });
  return { handler: handler!, authorizedGitPush: authorizedGitPush! };
}

test("normalizes the checkout origin", () => {
  expect(currentCheckoutRepository(process.cwd())).toBe(current);
});

test("only considers git push commands", () => {
  const handler = createGuard().handler;
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
  const result = createGuard().handler(
    { toolName: "bash", input: { command: 'git commit -m "mention git push"' } },
    { cwd: `/tmp/omp-github-write-guard-${crypto.randomUUID()}` },
  );

  expect(result).toBeUndefined();
});

test("hard-blocks resolved external targets synchronously", () => {
  const handler = createGuard().handler;
  const result = handler(
    {
      toolName: "bash",
      input: { command: ` git push --force-with-lease git@github.com:${external}.git HEAD` },
    },
    { cwd: process.cwd() },
  );

  expect(result).toEqual({
    block: true,
    reason:
      `Blocked git push targeting ${external}: the target differs from the current checkout (${current}).` +
      approvalInstructions,
  });
  expect(result).not.toBeInstanceOf(Promise);
});

test("uses standard approval for an authorized push", async () => {
  const calls: { command: string; args: string[]; cwd: string }[] = [];
  const { authorizedGitPush } = createGuard(async (command, args, { cwd }) => {
    calls.push({ command, args, cwd });
    return { code: 0, stdout: "", stderr: "" };
  });
  const repository = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  mkdirSync(repository, { recursive: true });
  try {
    execFileSync("git", ["init", repository]);
    execFileSync("git", ["-C", repository, "remote", "add", "origin", `git@github.com:${external}.git`]);

    expect(authorizedGitPush.approval).toEqual({
      tier: "exec",
      override: true,
      reason: "Git push can write to a repository outside the current checkout.",
    });
    expect(
      authorizedGitPush.formatApprovalDetails({
        remote: "origin",
        refspecs: ["HEAD"],
        cwd: repository,
      }),
    ).toEqual([
      "Git push remote: origin",
      "Refspecs: HEAD",
      `Working directory: ${repository}`,
    ]);
    await expect(
      authorizedGitPush.execute(
        "tool-call",
        { remote: "unknown", cwd: repository },
        undefined,
        undefined,
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow("GitHub push target cannot be resolved for unknown.");
    expect(calls).toEqual([]);
    expect(
      await authorizedGitPush.execute(
        "tool-call",
        { remote: "origin", refspecs: ["HEAD"], cwd: repository },
        undefined,
        undefined,
        { cwd: process.cwd() },
      ),
    ).toEqual({
      content: [{ type: "text", text: `Pushed to ${external}.` }],
      details: { target: external, remote: "origin", refspecs: ["HEAD"] },
    });
    expect(calls).toEqual([{ command: "git", args: ["push", "origin", "HEAD"], cwd: repository }]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
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
      createGuard().handler(
        { toolName: "bash", input: { command: "git push --atomic upstream", cwd: repository } },
        { cwd: repository },
      ),
    ).toEqual({
      block: true,
      reason:
        `Blocked git push targeting ${external}: the target differs from the current checkout (${current}).` +
        approvalInstructions,
    });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("resolves git -C push repositories", () => {
  const repository = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  mkdirSync(repository, { recursive: true });
  try {
    execFileSync("git", ["init", repository]);
    execFileSync("git", ["-C", repository, "remote", "add", "origin", `git@github.com:${external}.git`]);

    expect(
      createGuard().handler(
        { toolName: "bash", input: { command: `git -C ${repository} push origin` } },
        { cwd: process.cwd() },
      ),
    ).toEqual({
      block: true,
      reason:
        `Blocked git push targeting ${external}: the target differs from the current checkout (${current}).` +
        approvalInstructions,
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
      createGuard().handler(
        { toolName: "bash", input: { command: "git push origin", cwd: worktree } },
        { cwd: worktree },
      ),
    ).toBeUndefined();
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});
