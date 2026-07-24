import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { currentCheckoutRepository } from "../index.ts";
import { approve, checkout, context, current, external, guard } from "./test-support.ts";

test("resolves nested checkout origins", () => {
  const repository = checkout();
  const nested = `${repository}/nested`;
  try {
    mkdirSync(nested);
    expect([currentCheckoutRepository(repository), currentCheckoutRepository(nested)]).toEqual([current, current]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("resolves worktree origins", () => {
  const repository = checkout();
  const worktree = `/tmp/omp-repository-boundary-guard-${crypto.randomUUID()}`;
  try {
    execFileSync("git", ["-C", repository, "-c", "user.name=Guard", "-c", "user.email=guard@example.test", "commit", "--allow-empty", "-m", "initial"]);
    execFileSync("git", ["-C", repository, "worktree", "add", worktree, "-b", "feature"]);
    expect(currentCheckoutRepository(worktree)).toBe(current);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("permits mutations in local-only Git worktrees", async () => {
  const repository = checkout(null);
  const worktree = `/tmp/omp-repository-boundary-guard-${crypto.randomUUID()}`;
  const nested = `${repository}/nested`;
  try {
    execFileSync("git", ["-C", repository, "-c", "user.name=Guard", "-c", "user.email=guard@example.test", "commit", "--allow-empty", "-m", "initial"]);
    execFileSync("git", ["-C", repository, "worktree", "add", worktree, "-b", "feature"]);
    mkdirSync(nested);
    const instance = guard();
    const result = await instance.handler(
      { toolName: "write", input: { path: `${worktree}/inside.ts`, content: "export {};\n" } },
      context(nested),
    );
    expect([result, instance.messages]).toEqual([undefined, []]);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("permits writes in the active repository", async () => {
  const repository = checkout();
  try {
    const result = await guard().handler(
      { toolName: "write", input: { path: "inside.ts", content: "export {};\n" } },
      context(repository),
    );
    expect(result).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("retries an approved external write", async () => {
  const repository = checkout();
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  try {
    const instance = guard();
    const target = `${otherCheckout}/outside.ts`;
    const event = { toolName: "write", input: { path: target, content: "export {};\n" } };
    await instance.handler(event, context(repository));
    approve(instance, "file write", target);
    const retry = await instance.handler(event, context(repository));
    expect(retry).toBeUndefined();
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("asks before a resolved external write", async () => {
  const repository = checkout();
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  try {
    const target = `${otherCheckout}/outside.ts`;
    const result = await guard().handler(
      { toolName: "write", input: { path: target, content: "export {};\n" } },
      context(repository),
    );
    expect(result).toMatchObject({ block: true });
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("passes unresolved local targets without asking", async () => {
  const repository = checkout();
  const target = resolve(repository, "..", `unresolved-${crypto.randomUUID()}`, "created.ts");
  try {
    const instance = guard();
    const result = await instance.handler(
      { toolName: "write", input: { path: target, content: "" } },
      context(repository),
    );
    expect([result, instance.messages]).toEqual([undefined, []]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("asks before writes through symlinks into another repository", async () => {
  const repository = checkout();
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  try {
    symlinkSync(otherCheckout, `${repository}/outside`);
    const target = `${otherCheckout}/created.ts`;
    const event = { toolName: "write", input: { path: "outside/created.ts", content: "export {};\n" } };
    const instance = guard();
    const blocked = await instance.handler(event, context(repository));
    approve(instance, "file write", target);
    const retry = await instance.handler(event, context(repository));
    expect(retry).toBeUndefined();
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("asks before a symlink write into an external repository", async () => {
  const repository = checkout();
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  try {
    symlinkSync(otherCheckout, `${repository}/outside`);
    const result = await guard().handler(
      { toolName: "write", input: { path: "outside/created.ts", content: "export {};\n" } },
      context(repository),
    );
    expect(result).toMatchObject({ block: true });
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("permits moves within the same repository", async () => {
  const repository = checkout();
  const sameRepositoryCheckout = checkout();
  try {
    writeFileSync(`${repository}/inside.ts`, "export {};\n");
    const destination = relative(repository, sameRepositoryCheckout);
    const result = await guard().handler(
      {
        toolName: "edit",
        input: { input: `*** Begin Patch\n[inside.ts#ABCD]\nMV ${destination}/inside-moved.ts\n*** End Patch\n` },
      },
      context(repository),
    );
    expect(result).toBeUndefined();
  } finally {
    rmSync(sameRepositoryCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("passes dangling symlink targets without asking", async () => {
  const repository = checkout();
  try {
    symlinkSync("../outside-missing", `${repository}/dangling-outside`);
    const instance = guard();
    const result = await instance.handler(
      { toolName: "write", input: { path: "dangling-outside/created.ts", content: "" } },
      context(repository),
    );
    expect([result, instance.messages]).toEqual([undefined, []]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});


test("asks before moving to an external repository", async () => {
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  const repository = checkout();
  const destination = `${otherCheckout}/moved.ts`;
  try {
    writeFileSync(`${repository}/inside.ts`, "export {};\n");
    const event = {
      toolName: "edit",
      input: { input: `*** Begin Patch\n[inside.ts#ABCD]\nMV ${relative(repository, otherCheckout)}/moved.ts\n*** End Patch\n` },
    };
    const result = await guard().handler(event, context(repository));
    expect(result).toMatchObject({ block: true });
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("retries an approved move to an external repository", async () => {
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  const repository = checkout();
  const destination = `${otherCheckout}/moved.ts`;
  try {
    writeFileSync(`${repository}/inside.ts`, "export {};\n");
    const event = {
      toolName: "edit",
      input: { input: `*** Begin Patch\n[inside.ts#ABCD]\nMV ${relative(repository, otherCheckout)}/moved.ts\n*** End Patch\n` },
    };
    const instance = guard();
    await instance.handler(event, context(repository));
    approve(instance, "file edit", destination);
    const result = await instance.handler(event, context(repository));
    expect(result).toBeUndefined();
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("asks before moving from an external repository", async () => {
  const repository = checkout();
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  const source = `${otherCheckout}/outside.ts`;
  try {
    writeFileSync(source, "export {};\n");
    const event = {
      toolName: "edit",
      input: { input: `*** Begin Patch\n[${relative(repository, otherCheckout)}/outside.ts#ABCD]\nMV moved.ts\n*** End Patch\n` },
    };
    const result = await guard().handler(event, context(repository));
    expect(result).toMatchObject({ block: true });
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("retries an approved move from an external repository", async () => {
  const repository = checkout();
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  const source = `${otherCheckout}/outside.ts`;
  try {
    writeFileSync(source, "export {};\n");
    const event = {
      toolName: "edit",
      input: { input: `*** Begin Patch\n[${relative(repository, otherCheckout)}/outside.ts#ABCD]\nMV moved.ts\n*** End Patch\n` },
    };
    const instance = guard();
    await instance.handler(event, context(repository));
    approve(instance, "file edit", source);
    const result = await instance.handler(event, context(repository));
    expect(result).toBeUndefined();
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});
