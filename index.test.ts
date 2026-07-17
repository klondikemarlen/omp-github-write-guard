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

test("does not treat quoted git push text as a write", async () => {
  const result = await hookHandler()(
    { toolName: "bash", input: { command: 'git commit -m "mention git push"' } },
    { cwd: process.cwd(), hasUI: true, ui: { confirm: () => true } },
  );

  expect(result).toBeUndefined();
});

test("recognizes leading-whitespace git push commands", () => {
  expect(
    guardDecision({ command: ` git push git@github.com:${external}.git HEAD` }, current),
  ).toMatchObject({ target: external, requiresConfirmation: true });
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

test("requires confirmation for unresolved checkouts or targets", () => {
  expect(guardDecision({ command: "gh issue create" })).toMatchObject({
    allow: false,
    reason: "the current checkout has no resolvable GitHub origin repository",
    requiresConfirmation: true,
  });
  expect(guardDecision({ command: 'gh pr create --repo ""' }, current)).toMatchObject({
    allow: false,
    reason: "the GitHub target cannot be resolved",
    requiresConfirmation: true,
  });
  expect(guardDecision(githubOperation("repo_fork", current), current)).toMatchObject({
    allow: false,
    reason: "the GitHub target cannot be resolved",
    requiresConfirmation: true,
  });
});

test("resolves named push remotes with atomic pushes", async () => {
  const repository = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  mkdirSync(repository, { recursive: true });
  try {
    execFileSync("git", ["init", repository]);
    execFileSync("git", ["-C", repository, "remote", "add", "origin", `git@github.com:${current}.git`]);
    execFileSync("git", ["-C", repository, "remote", "add", "upstream", `git@github.com:${current}.git`]);
    execFileSync("git", ["-C", repository, "remote", "set-url", "--push", "upstream", `git@github.com:${external}.git`]);
    let prompt = "";

    expect(
      await hookHandler()(
        { toolName: "bash", input: { command: "git push --atomic upstream", cwd: repository } },
        {
          cwd: repository,
          hasUI: true,
          ui: { confirm: (_title, message) => ((prompt = message), true) },
        },
      ),
    ).toBeUndefined();
    expect(prompt).toContain(`git push will write to ${external}`);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("describes unresolved source or target in confirmations", async () => {
  const prompts: string[] = [];
  const handler = hookHandler();
  const context = {
    cwd: `/tmp/omp-github-write-guard-${crypto.randomUUID()}`,
    hasUI: true,
    ui: {
      confirm: (_title: string, message: string) => {
        prompts.push(message);
        return true;
      },
    },
  };

  expect(await handler({ toolName: "github", input: { op: "issue_create", repo: external } }, context)).toBeUndefined();
  expect(prompts[0]).toContain("an unresolved session checkout");
  expect(await handler({ toolName: "github", input: { op: "repo_fork" } }, { ...context, cwd: process.cwd() })).toBeUndefined();
  expect(prompts[1]).toContain("an unresolved target");
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

test("blocks duplicate uncertain writes while a confirmation is pending", async () => {
  let confirmations = 0;
  let resolveConfirmation!: (confirmed: boolean) => void;
  const handler = hookHandler();
  const context = {
    cwd: process.cwd(),
    hasUI: true,
    ui: {
      confirm: () => {
        confirmations++;
        return new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve;
        });
      },
    },
  };
  const event = { toolName: "github" as const, input: { op: "repo_fork" } };

  const first = handler(event, context);
  const retry = await handler(event, context);
  expect(retry).toMatchObject({ block: true, reason: expect.stringContaining("already pending") });
  expect(confirmations).toBe(1);

  resolveConfirmation(true);
  expect(await first).toBeUndefined();
  const next = handler(event, context);
  expect(confirmations).toBe(2);
  resolveConfirmation(true);
  expect(await next).toBeUndefined();
});

test("clears pending confirmations after rejection or failure", async () => {
  const handler = hookHandler();
  const event = { toolName: "github" as const, input: { op: "repo_fork" } };
  let confirmations = 0;
  let failConfirmation = false;
  const context = {
    cwd: process.cwd(),
    hasUI: true,
    ui: {
      confirm: () => {
        confirmations++;
        if (failConfirmation) return Promise.reject(new Error("cancelled"));
        return confirmations === 1 ? false : true;
      },
    },
  };

  expect(await handler(event, context)).toMatchObject({ block: true });
  expect(await handler(event, context)).toBeUndefined();

  failConfirmation = true;
  expect(await handler(event, context)).toMatchObject({
    block: true,
    reason: expect.stringContaining("could not be completed"),
  });
  failConfirmation = false;
  expect(await handler(event, context)).toBeUndefined();
  expect(confirmations).toBe(4);
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
