import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { relative } from "node:path";

import { repositoryMutationHandoff } from "../index.ts";
import { approve, checkout, context, external, guard } from "./test-support.ts";

test("passes same-origin pushes", async () => {
  const repository = checkout();
  try {
    const result = await guard().handler(
      { toolName: "bash", input: { command: "git push origin HEAD" } },
      context(repository),
    );
    expect(result).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("passes named push remotes without a repository resolution", () => {
  const repository = checkout();
  try {
    const result = repositoryMutationHandoff(
      { toolName: "bash", input: { command: `git push ${external} HEAD` } },
      repository,
    );
    expect(result).toMatchObject({ decision: "allow" });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("passes non-push Git commands", async () => {
  const repository = checkout();
  try {
    const result = await guard().handler(
      { toolName: "bash", input: { command: "git status --short" } },
      context(repository),
    );
    expect(result).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("asks before an external push", async () => {
  const repository = checkout();
  try {
    const result = await guard().handler(
      { toolName: "bash", input: { command: `git push https://github.com/${external}.git HEAD` } },
      context(repository),
    );
    expect(result).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("retries one approved external push", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const event = { toolName: "bash", input: { command: `git push https://github.com/${external}.git HEAD` } };
    await instance.handler(event, context(repository));
    approve(instance, "git push", external, `\nCommand: ${event.input.command}`);
    const result = await instance.handler(event, context(repository));
    expect(result).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("resolves the configured default push remote", async () => {
  const repository = checkout();
  try {
    execFileSync("git", ["-C", repository, "remote", "add", "upstream", `https://github.com/${external}.git`]);
    execFileSync("git", ["-C", repository, "config", "remote.pushDefault", "upstream"]);
    const result = await guard().handler(
      { toolName: "bash", input: { command: "git push" } },
      context(repository),
    );
    expect(result).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("classifies a quoted Git -C push", async () => {
  const repository = `${checkout()} space`;
  try {
    execFileSync("mv", [repository.slice(0, -6), repository]);
    execFileSync("git", ["-C", repository, "remote", "add", "upstream", `git@github.com:${external}.git`]);
    const result = await guard().handler(
      { toolName: "bash", input: { command: `echo ready && git -c user.name=Guard --no-pager -C\"${repository}\" push upstream HEAD` } },
      context(repository),
    );
    expect(result).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("requires a new approval when an external push changes", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const original = { toolName: "bash", input: { command: `git push https://github.com/${external}.git HEAD` } };
    const changed = { toolName: "bash", input: { command: `git push --force https://github.com/${external}.git HEAD` } };
    await instance.handler(original, context(repository));
    approve(instance, "git push", external, `\nCommand: ${original.input.command}`);
    const result = await instance.handler(changed, context(repository));
    expect(result).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("passes unsupported Git repository options", async () => {
  const repository = checkout();
  try {
    const result = await guard().handler(
      { toolName: "bash", input: { command: "git --git-dir=/tmp/other.git push origin HEAD" } },
      context(repository),
    );
    expect(result).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("passes quoted push text", async () => {
  const repository = checkout();
  try {
    const result = await guard().handler(
      { toolName: "bash", input: { command: "echo 'git push https://github.com/elsewhere/example.git'" } },
      context(repository),
    );
    expect(result).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("passes dry-run pushes", async () => {
  const repository = checkout();
  try {
    const result = await guard().handler(
      { toolName: "bash", input: { command: `git push --dry-run https://github.com/${external}.git HEAD` } },
      context(repository),
    );
    expect(result).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("passes push help", async () => {
  const repository = checkout();
  try {
    const result = await guard().handler(
      { toolName: "bash", input: { command: `git push --help --repo ${external}` } },
      context(repository),
    );
    expect(result).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("consumes an approved push once", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const event = { toolName: "bash", input: { command: `git push https://github.com/${external}.git HEAD` } };
    await instance.handler(event, context(repository));
    approve(instance, "git push", external, `\nCommand: ${event.input.command}`);
    await instance.handler(event, context(repository));
    const result = await instance.handler(event, context(repository));
    expect(result).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not carry approval across session directories", async () => {
  const repository = checkout();
  const sibling = checkout();
  try {
    const instance = guard();
    const event = { toolName: "bash", input: { command: `git push https://github.com/${external}.git HEAD` } };
    await instance.handler(event, context(repository));
    approve(instance, "git push", external, `\nCommand: ${event.input.command}`);
    const result = await instance.handler(event, context(sibling));
    expect(result).toMatchObject({ block: true });
  } finally {
    rmSync(sibling, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("re-prompts after an interrupted approval", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const event = { toolName: "bash", input: { command: `git push https://github.com/${external}.git HEAD` } };
    await instance.handler(event, context(repository));
    instance.answer({ toolName: "ask", input: { questions: [] }, details: {}, isError: false });
    const result = await instance.handler(event, context(repository));
    expect(result).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not retain a prior checkout switch", async () => {
  const repository = checkout();
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  try {
    const instance = guard();
    await instance.handler(
      { toolName: "bash", input: { command: `cd ${relative(repository, otherCheckout)} && git status --short` } },
      context(repository),
    );
    const result = await instance.handler(
      { toolName: "bash", input: { command: `git push git@github.com:${external}.git HEAD` } },
      context(repository),
    );
    expect(result).toMatchObject({ block: true });
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("resolves relative tool directories from the session checkout", async () => {
  const repository = checkout();
  try {
    mkdirSync(`${repository}/web`);
    mkdirSync(`${repository}/api`);
    const instance = guard();
    await instance.handler(
      { toolName: "bash", input: { command: "git status --short", cwd: "web" } },
      context(repository),
    );
    await instance.handler(
      { toolName: "bash", input: { command: "git status --short", cwd: "api" } },
      context(repository),
    );
    const result = await instance.handler(
      { toolName: "bash", input: { command: "git push origin HEAD" } },
      context(repository),
    );
    expect(result).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
