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

type AuthorizedGitPush = {
  approval: "exec";
  formatApprovalDetails(params: { remote: string; refspecs?: string[]; cwd?: string }): string[];
  execute(
    toolCallId: string,
    params: { remote: string; refspecs?: string[]; cwd?: string },
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: { cwd: string },
  ): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }>;
};
type ToolResultHandler = (
  event: {
    toolName: string;
    input: Record<string, unknown>;
    details: unknown;
    isError: boolean;
  },
  ctx: { cwd: string; hasUI?: boolean },
) => void;

function createGuard(
  exec = async () => ({ code: 0, stdout: "", stderr: "" }),
  sendUserMessage = (_content: string) => {},
) {
  let toolCallHandler: ToolCallHandler | undefined;
  let toolResultHandler: ToolResultHandler | undefined;
  let authorizedGitPush: AuthorizedGitPush | undefined;
  const schema = {
    describe: () => schema,
    optional: () => schema,
  };
  createGitHubWriteGuard()({
    on: (event, handler) => {
      if (event === "tool_call") toolCallHandler = handler;
      else toolResultHandler = handler;
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
    sendUserMessage,
  });
  return {
    handler: toolCallHandler!,
    resultHandler: toolResultHandler!,
    authorizedGitPush: authorizedGitPush!,
  };
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

test("classifies static shell pushes and blocks ambiguous commands", () => {
  expect(
    guardDecision({ command: `git --no-pager push git@github.com:${external}.git HEAD` }, current),
  ).toMatchObject({ allow: false });
  expect(
    guardDecision({ command: `git -C/tmp push git@github.com:${external}.git HEAD` }, current),
  ).toMatchObject({ allow: false, target: external });
  expect(
    guardDecision(
      { command: `git -C "/tmp/directory with spaces" push git@github.com:${external}.git HEAD` },
      current,
    ),
  ).toMatchObject({ allow: false, target: external });
  expect(
    guardDecision({ command: `TOKEN=value git push git@github.com:${external}.git HEAD` }, current),
  ).toMatchObject({ allow: false });
  expect(
    guardDecision({ command: `bun -e 'console.log("git push git@github.com:${external}.git")'` }, current),
  ).toEqual({ allow: true });
  expect(
    guardDecision(
      { command: `git push origin && git push git@github.com:${external}.git HEAD` },
      current,
    ),
  ).toMatchObject({ allow: false, target: undefined });
  expect(
    guardDecision({ command: `echo $(git push git@github.com:${external}.git HEAD)` }, current),
  ).toMatchObject({ allow: false, target: undefined });
  expect(
    guardDecision(
      { command: `git push origin && echo $(git push git@github.com:${external}.git HEAD)` },
      current,
    ),
  ).toMatchObject({ allow: false, target: undefined });
  expect(
    guardDecision(
      { command: `echo ok\ngit push git@github.com:${external}.git HEAD` },
      current,
    ),
  ).toMatchObject({ allow: false, target: undefined });
});

test("steers external pushes to the default ask tool", () => {
  const messages: string[] = [];
  const { handler } = createGuard(undefined, (content) => messages.push(content));
  const result = handler(
    {
      toolName: "bash",
      input: { command: `git push git@github.com:${external}.git HEAD` },
    },
    { cwd: process.cwd(), hasUI: true },
  );

  expect(result).toEqual({
    block: true,
    reason:
      `Blocked git push targeting ${external}: the target differs from the current checkout (${current}). ` +
      "OMP ask authorization requested.",
  });
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('Call the ask tool now with one question: id "authorize_git_push"');
  expect(messages[0]).toContain(`Allow git push to ${external}?`);
});

test("resolves the configured target for an unqualified push", () => {
  const repository = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  mkdirSync(repository, { recursive: true });
  try {
    execFileSync("git", ["init", repository]);
    execFileSync("git", ["-C", repository, "remote", "add", "origin", `git@github.com:${current}.git`]);
    const guard = createGuard();

    expect(
      guard.handler(
        { toolName: "bash", input: { command: "git push", cwd: repository } },
        { cwd: repository, hasUI: true },
      ),
    ).toBeUndefined();

    const branch = execFileSync("git", ["-C", repository, "symbolic-ref", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["-C", repository, "remote", "add", "upstream", `git@github.com:${external}.git`]);
    execFileSync("git", ["-C", repository, "config", "remote.pushDefault", "upstream"]);
    expect(
      guard.handler(
        { toolName: "bash", input: { command: "git push", cwd: repository } },
        { cwd: repository, hasUI: false },
      ),
    ).toMatchObject({ block: true, reason: expect.stringContaining(external) });

    execFileSync("git", ["-C", repository, "config", `branch.${branch}.pushRemote`, "origin"]);
    expect(
      guard.handler(
        { toolName: "bash", input: { command: "git push", cwd: repository } },
        { cwd: repository, hasUI: true },
      ),
    ).toBeUndefined();

    execFileSync("git", ["-C", repository, "config", "--unset", `branch.${branch}.pushRemote`]);
    execFileSync("git", ["-C", repository, "config", "--unset", "remote.pushDefault"]);
    execFileSync("git", ["-C", repository, "config", `branch.${branch}.remote`, "upstream"]);
    expect(
      guard.handler(
        { toolName: "bash", input: { command: "git push", cwd: repository } },
        { cwd: repository, hasUI: false },
      ),
    ).toMatchObject({ block: true, reason: expect.stringContaining(external) });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("executes exactly one push after the matching ask approval", async () => {
  const calls: { command: string; args: string[]; cwd: string }[] = [];
  const messages: string[] = [];
  const guard = createGuard(
    async (command, args, { cwd }) => {
      calls.push({ command, args, cwd });
      return { code: 0, stdout: "", stderr: "" };
    },
    (content) => messages.push(content),
  );
  const repository = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  mkdirSync(repository, { recursive: true });
  try {
    execFileSync("git", ["init", repository]);
    execFileSync("git", ["-C", repository, "remote", "add", "origin", `git@github.com:${external}.git`]);

    expect(
      guard.handler(
        { toolName: "bash", input: { command: "git push origin", cwd: repository } },
        { cwd: process.cwd(), hasUI: true },
      ),
    ).toMatchObject({ block: true });
    expect(messages).toHaveLength(1);
    expect(guard.authorizedGitPush.approval).toBe("exec");
    expect(
      guard.authorizedGitPush.formatApprovalDetails({
        remote: "origin",
        refspecs: ["HEAD"],
        cwd: repository,
      }),
    ).toEqual([
      `Git push target: ${external}`,
      "Refspecs: HEAD",
      `Working directory: ${repository}`,
    ]);
    await expect(
      guard.authorizedGitPush.execute(
        "tool-call",
        { remote: "origin", cwd: repository },
        undefined,
        undefined,
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(`Git push to ${external} requires an approved OMP ask prompt.`);
    guard.resultHandler(
      {
        toolName: "ask",
        input: {
          questions: [
            {
              id: "authorize_git_push",
              question: `Allow git push to ${external}?`,
            },
          ],
        },
        details: { selectedOptions: ["Approve push"] },
        isError: false,
      },
      { cwd: process.cwd(), hasUI: true },
    );
    expect(
      await guard.authorizedGitPush.execute(
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
    await expect(
      guard.authorizedGitPush.execute(
        "tool-call",
        { remote: "origin", cwd: repository },
        undefined,
        undefined,
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(`Git push to ${external} requires an approved OMP ask prompt.`);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not authorize a rejected ask or headless push", async () => {
  const messages: string[] = [];
  const guard = createGuard(undefined, (content) => messages.push(content));
  const repository = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  mkdirSync(repository, { recursive: true });
  try {
    execFileSync("git", ["init", repository]);
    execFileSync("git", ["-C", repository, "remote", "add", "origin", `git@github.com:${external}.git`]);

    expect(
      guard.handler(
        { toolName: "bash", input: { command: "git push origin", cwd: repository } },
        { cwd: process.cwd(), hasUI: false },
      ),
    ).toMatchObject({
      block: true,
      reason: expect.stringContaining("Interactive authorization requires OMP UI."),
    });
    expect(messages).toEqual([]);
    expect(
      guard.handler(
        { toolName: "bash", input: { command: "git push origin", cwd: repository } },
        { cwd: process.cwd(), hasUI: true },
      ),
    ).toMatchObject({ block: true });
    guard.resultHandler(
      {
        toolName: "ask",
        input: {
          questions: [
            {
              id: "authorize_git_push",
              question: `Allow git push to ${external}?`,
            },
          ],
        },
        details: { selectedOptions: ["Reject push"] },
        isError: false,
      },
      { cwd: process.cwd(), hasUI: true },
    );
    await expect(
      guard.authorizedGitPush.execute(
        "tool-call",
        { remote: "origin", cwd: repository },
        undefined,
        undefined,
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(`Git push to ${external} requires an approved OMP ask prompt.`);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("retries authorization after an unrelated Ask result", () => {
  const messages: string[] = [];
  const guard = createGuard(undefined, (content) => messages.push(content));
  const event = {
    toolName: "bash",
    input: { command: `git push git@github.com:${external}.git HEAD` },
  };
  const context = { cwd: process.cwd(), hasUI: true };

  expect(guard.handler(event, context)).toMatchObject({ block: true });
  guard.resultHandler(
    {
      toolName: "ask",
      input: { questions: [{ id: "unrelated", question: "Continue?" }] },
      details: { selectedOptions: ["Continue"] },
      isError: false,
    },
    context,
  );
  expect(guard.handler(event, context)).toMatchObject({ block: true });
  expect(messages).toHaveLength(2);
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

test("resolves named and git -C push remotes", () => {
  const repository = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  mkdirSync(repository, { recursive: true });
  try {
    execFileSync("git", ["init", repository]);
    execFileSync("git", ["-C", repository, "remote", "add", "origin", `git@github.com:${current}.git`]);
    execFileSync("git", ["-C", repository, "remote", "add", "upstream", `git@github.com:${external}.git`]);
    const guard = createGuard();

    expect(
      guard.handler(
        { toolName: "bash", input: { command: "git push --atomic upstream", cwd: repository } },
        { cwd: repository, hasUI: false },
      ),
    ).toMatchObject({ block: true, reason: expect.stringContaining(external) });
    expect(
      createGuard().handler(
        { toolName: "bash", input: { command: `git -C ${repository} push upstream` } },
        { cwd: process.cwd(), hasUI: false },
      ),
    ).toMatchObject({ block: true, reason: expect.stringContaining(external) });
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
        { cwd: worktree, hasUI: true },
      ),
    ).toBeUndefined();
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});
