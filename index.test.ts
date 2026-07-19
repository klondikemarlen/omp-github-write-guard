import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

import {
  createGitHubWriteGuard,
  currentCheckoutRepository,
  type ToolCallHandler,
} from "./index.ts";

const current = "klondikemarlen/omp-github-write-guard";
const external = "elsewhere/example";
const confirmationId = "confirm_external_github_write";

type Guard = {
  handler: ToolCallHandler;
  answer(event: { toolName: string; input: Record<string, unknown>; details: unknown; isError: boolean }): void;
  messages: string[];
};

function guard(): Guard {
  let handler: ToolCallHandler | undefined;
  let resultHandler: Guard["answer"] | undefined;
  const messages: string[] = [];
  createGitHubWriteGuard()({
    on: ((event: string, registered: ToolCallHandler | Guard["answer"]) => {
      if (event === "tool_call") handler = registered as ToolCallHandler;
      else resultHandler = registered as Guard["answer"];
    }) as never,
    sendUserMessage: (message) => messages.push(message),
  });
  return { handler: handler!, answer: (event) => resultHandler!(event), messages };
}

function checkout(remote = `https://github.com/${current}.git`) {
  const directory = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  mkdirSync(directory, { recursive: true });
  execFileSync("git", ["-C", directory, "init", "--quiet"]);
  execFileSync("git", ["-C", directory, "remote", "add", "origin", remote]);
  return directory;
}

function context(cwd: string, hasUI = true) {
  return { cwd, hasUI };
}

function approve(guard: Guard, action: string, target: string) {
  guard.answer({
    toolName: "ask",
    input: {
      questions: [{ id: confirmationId, question: `Allow one ${action} to ${target}?` }],
    },
    details: { selectedOptions: ["Approve"] },
    isError: false,
  });
}

test("resolves the checkout origin", () => {
  const repository = checkout();
  try {
    expect(currentCheckoutRepository(repository)).toBe(current);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not intercept same-origin pushes", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const result = await instance.handler(
      { toolName: "bash", input: { command: "git push origin HEAD" } },
      context(repository),
    );
    expect(result).toBeUndefined();
    expect(instance.messages).toEqual([]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("classifies global options, attached and quoted -C paths, and command sequences", async () => {
  const repository = `${checkout()} space`;
  try {
    execFileSync("mv", [repository.slice(0, -6), repository]);
    execFileSync("git", ["-C", repository, "remote", "add", "upstream", `git@github.com:${external}.git`]);
    const instance = guard();
    const result = await instance.handler(
      { toolName: "bash", input: { command: `echo ready && git -c user.name=Guard --no-pager -C\"${repository}\" push upstream HEAD` } },
      context(repository),
    );
    expect(result).toMatchObject({ block: true, reason: expect.stringContaining("OMP ask") });
    expect(instance.messages).toHaveLength(1);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("fails closed for an unsupported repository-affecting global option", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const result = await instance.handler(
      { toolName: "bash", input: { command: "git --git-dir=/tmp/other.git push origin HEAD" } },
      context(repository),
    );
    expect(result).toMatchObject({ block: true, reason: expect.stringContaining("cannot be resolved") });
    expect(instance.messages).toEqual([]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not mistake quoted push text for an executable push", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const result = await instance.handler(
      { toolName: "bash", input: { command: "echo 'git push https://github.com/elsewhere/example.git'" } },
      context(repository),
    );
    expect(result).toBeUndefined();
    expect(instance.messages).toEqual([]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("resolves the configured default push remote", async () => {
  const repository = checkout();
  try {
    execFileSync("git", ["-C", repository, "remote", "add", "upstream", `https://github.com/${external}.git`]);
    execFileSync("git", ["-C", repository, "config", "remote.pushDefault", "upstream"]);
    const instance = guard();
    const result = await instance.handler(
      { toolName: "bash", input: { command: "git push" } },
      context(repository),
    );
    expect(result).toMatchObject({ block: true, reason: expect.stringContaining(external) });
    expect(instance.messages).toHaveLength(1);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("permits exactly one approved external push retry", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const event = { toolName: "bash", input: { command: `git push https://github.com/${external}.git HEAD` } };
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    approve(instance, "git push", external);
    expect(await instance.handler(event, context(repository))).toBeUndefined();
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("clears an interrupted or mismatched confirmation", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const event = { toolName: "bash", input: { command: `git push https://github.com/${external}.git HEAD` } };
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    instance.answer({ toolName: "ask", input: { questions: [] }, details: {}, isError: false });
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true, reason: expect.stringContaining("OMP ask") });
    expect(instance.messages).toHaveLength(2);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("confirms external issue creation through the GitHub device", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const event = {
      toolName: "write",
      input: { path: "xd://github", content: JSON.stringify({ op: "issue_create", repo: external }) },
    };
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    approve(instance, "GitHub issue creation", external);
    expect(await instance.handler(event, context(repository))).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not prompt same-origin issue creation", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const result = await instance.handler(
      {
        toolName: "write",
        input: { path: "xd://github", content: JSON.stringify({ op: "issue_create", repo: current }) },
      },
      context(repository),
    );
    expect(result).toBeUndefined();
    expect(instance.messages).toEqual([]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not intercept draft pull requests or same-origin force-with-lease delivery", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    expect(
      await instance.handler(
        {
          toolName: "write",
          input: { path: "xd://github", content: JSON.stringify({ op: "pr_create", repo: external, draft: true }) },
        },
        context(repository),
      ),
    ).toBeUndefined();
    expect(
      await instance.handler(
        { toolName: "bash", input: { command: "git push --force-with-lease origin HEAD" } },
        context(repository),
      ),
    ).toBeUndefined();
    expect(instance.messages).toEqual([]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("fails closed without interactive confirmation", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const result = await instance.handler(
      { toolName: "bash", input: { command: `gh issue create --repo ${external}` } },
      context(repository, false),
    );
    expect(result).toMatchObject({ block: true, reason: expect.stringContaining("Interactive confirmation") });
    expect(instance.messages).toEqual([]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
