import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { relative } from "node:path";

import {
  createRepositoryBoundaryGuard,
  currentCheckoutRepository,
  repositoryMutationHandoff,
  type ToolCallHandler,
} from "../index.ts";

const current = "klondikemarlen/omp-github-write-guard";
const external = "elsewhere/example";
const confirmationId = "confirm_repository_boundary_mutation";

type Guard = {
  handler: ToolCallHandler;
  answer(event: { toolName: string; input: Record<string, unknown>; details: unknown; isError: boolean }): void;
  messages: string[];
};

function guard(): Guard {
  let handler: ToolCallHandler | undefined;
  let resultHandler: Guard["answer"] | undefined;
  const messages: string[] = [];
  createRepositoryBoundaryGuard()({
    on: ((event: string, registered: ToolCallHandler | Guard["answer"]) => {
      if (event === "tool_call") handler = registered as ToolCallHandler;
      else resultHandler = registered as Guard["answer"];
    }) as never,
    sendUserMessage: (message) => messages.push(message),
  });
  return { handler: handler!, answer: (event) => resultHandler!(event), messages };
}

function checkout(remote: string | null = `https://github.com/${current}.git`) {
  const directory = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  mkdirSync(directory, { recursive: true });
  execFileSync("git", ["-C", directory, "init", "--quiet"]);
  if (remote) execFileSync("git", ["-C", directory, "remote", "add", "origin", remote]);
  return directory;
}

function context(cwd: string, hasUI = true) {
  return { cwd, hasUI };
}

function approve(guard: Guard, action: string, target: string, detail = "") {
  guard.answer({
    toolName: "ask",
    input: {
      questions: [{ id: confirmationId, question: `Allow one ${action} to ${target}?${detail}` }],
    },
    details: { selectedOptions: ["Approve"] },
    isError: false,
  });
}

test("resolves nested checkout origins", () => {
  const repository = checkout();
  const nested = `${repository}/nested`;
  try {
    mkdirSync(nested);
    expect(currentCheckoutRepository(repository)).toBe(current);
    expect(currentCheckoutRepository(nested)).toBe(current);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("resolves worktree origins", () => {
  const repository = checkout();
  const worktree = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
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
  const worktree = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  const nested = `${repository}/nested`;
  try {
    execFileSync("git", ["-C", repository, "-c", "user.name=Guard", "-c", "user.email=guard@example.test", "commit", "--allow-empty", "-m", "initial"]);
    execFileSync("git", ["-C", repository, "worktree", "add", worktree, "-b", "feature"]);
    mkdirSync(nested);
    const instance = guard();
    expect(await instance.handler(
      { toolName: "write", input: { path: `${worktree}/inside.ts`, content: "export {};\n" } },
      context(nested),
    )).toBeUndefined();
    expect(instance.messages).toEqual([]);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("keeps same-origin GitHub writes inside a worktree", async () => {
  const repository = checkout();
  const worktree = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  try {
    execFileSync("git", ["-C", repository, "-c", "user.name=Guard", "-c", "user.email=guard@example.test", "commit", "--allow-empty", "-m", "initial"]);
    execFileSync("git", ["-C", repository, "worktree", "add", worktree, "-b", "feature"]);
    const otherFromWorktree = relative(worktree, otherCheckout);
    const instance = guard();
    expect(await instance.handler({ toolName: "bash", input: { command: `cd ${otherFromWorktree} && echo ready` } }, context(worktree))).toBeUndefined();

    for (const [command, action] of [
      [`gh issue close 1 --repo ${current}`, "GitHub issue update"],
      [`gh issue create --repo ${current} --title "Same checkout"`, "GitHub issue creation"],
      [`gh pr create --repo ${current}`, "GitHub pull request creation"],
      [`gh pr merge 1 --repo ${current} --merge --delete-branch`, "GitHub pull request update"],
      [`git push git@github.com:${current}.git HEAD:refs/heads/same-origin`, "git push"],
    ]) {
      expect(repositoryMutationHandoff({ toolName: "bash", input: { command } }, worktree)).toMatchObject({
        decision: "allow",
        action,
        currentRepository: current,
        target: current,
      });
      expect(await instance.handler({ toolName: "bash", input: { command } }, context(worktree))).toBeUndefined();
    }
    expect(instance.messages).toEqual([]);
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
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

test("permits writes in same-repository checkouts and asks before external writes", async () => {
  const repository = checkout();
  const sameRepositoryCheckout = checkout();
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  try {
    const instance = guard();
    expect(await instance.handler(
      { toolName: "write", input: { path: "inside.ts", content: "export {};\n" } },
      context(repository),
    )).toBeUndefined();
    expect(await instance.handler(
      { toolName: "write", input: { path: `${sameRepositoryCheckout}/inside.ts`, content: "export {};\n" } },
      context(repository),
    )).toBeUndefined();
    expect(instance.messages).toEqual([]);

    const target = `${otherCheckout}/outside.ts`;
    const event = { toolName: "write", input: { path: target, content: "export {};\n" } };
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    approve(instance, "file write", target);
    expect(await instance.handler(event, context(repository))).toBeUndefined();
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(sameRepositoryCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("asks before writes through symlinks into another repository", async () => {
  const repository = checkout();
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  try {
    symlinkSync(otherCheckout, `${repository}/outside`);
    const instance = guard();
    const target = `${otherCheckout}/created.ts`;
    const event = { toolName: "write", input: { path: "outside/created.ts", content: "export {};\n" } };
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    approve(instance, "file write", target);
    expect(await instance.handler(event, context(repository))).toBeUndefined();
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("asks before moves with an external source or destination", async () => {
  const repository = checkout();
  const sameRepositoryCheckout = checkout();
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  try {
    writeFileSync(`${repository}/inside.ts`, "export {};\n");
    writeFileSync(`${otherCheckout}/outside.ts`, "export {};\n");
    const sameFromRepository = relative(repository, sameRepositoryCheckout);
    const otherFromRepository = relative(repository, otherCheckout);
    const instance = guard();
    expect(await instance.handler(
      {
        toolName: "edit",
        input: { input: `*** Begin Patch\n[inside.ts#ABCD]\nMV ${sameFromRepository}/inside-moved.ts\n*** End Patch\n` },
      },
      context(repository),
    )).toBeUndefined();

    for (const [source, destination, target] of [
      ["inside.ts", `${otherFromRepository}/moved.ts`, `${otherCheckout}/moved.ts`],
      [`${otherFromRepository}/outside.ts`, "moved.ts", `${otherCheckout}/outside.ts`],
    ]) {
      const event = {
        toolName: "edit",
        input: { input: `*** Begin Patch\n[${source}#ABCD]\nMV ${destination}\n*** End Patch\n` },
      };
      expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
      approve(instance, "file edit", target);
      expect(await instance.handler(event, context(repository))).toBeUndefined();
    }
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(sameRepositoryCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("resolves write targets without redefining the active repository boundary", async () => {
  const repository = checkout();
  const sameRepositoryCheckout = checkout();
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  try {
    const instance = guard();
    expect(await instance.handler(
      { toolName: "write", input: { path: "created.ts", content: "", cwd: sameRepositoryCheckout } },
      context(repository),
    )).toBeUndefined();

    const target = `${otherCheckout}/created.ts`;
    const event = { toolName: "write", input: { path: "created.ts", content: "", cwd: otherCheckout } };
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    approve(instance, "file write", target);
    expect(await instance.handler(event, context(repository))).toBeUndefined();
    expect(await instance.handler(
      { toolName: "write", input: { path: "file:///tmp/outside.ts", content: "" } },
      context(repository),
    )).toMatchObject({ block: true, reason: expect.stringContaining("cannot be resolved") });
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(sameRepositoryCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("anchors GitHub mutation authorization to the active checkout", () => {
  const repository = checkout();
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  const unresolved = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  mkdirSync(unresolved);
  try {
    const otherFromRepository = relative(repository, otherCheckout);
    for (const event of [
      { toolName: "bash", input: { command: "git -C . push origin HEAD", cwd: otherFromRepository } },
      { toolName: "bash", input: { command: "gh pr create", cwd: otherFromRepository } },
      { toolName: "bash", input: { command: `cd ${otherFromRepository} && gh pr create` } },
      { toolName: "bash", input: { command: `gh pr create --repo ${external}`, cwd: unresolved } },
    ]) {
      expect(repositoryMutationHandoff(event, repository)).toMatchObject({
        decision: "ask",
        currentRepository: current,
        target: external,
      });
    }
  } finally {
    rmSync(unresolved, { recursive: true, force: true });
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("requires named push remotes to resolve through Git configuration", () => {
  const repository = checkout();
  try {
    expect(
      repositoryMutationHandoff(
        { toolName: "bash", input: { command: `git push ${external} HEAD` } },
        repository,
      ),
    ).toMatchObject({ decision: "block", action: "git push", reason: expect.stringContaining("cannot be resolved") });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not intercept local non-push Git commands", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    for (const command of ["git status --short", "git -C . add file.ts", 'git commit -m "mention push"']) {
      expect(await instance.handler({ toolName: "bash", input: { command } }, context(repository))).toBeUndefined();
    }
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
    approve(instance, "git push", external, `\nCommand: ${event.input.command}`);
    expect(await instance.handler(event, context(repository))).toBeUndefined();
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("retries a relative checkout change after an approved push", async () => {
  const repository = checkout();
  const otherCheckout = checkout("https://github.com/elsewhere/other.git");
  try {
    const instance = guard();
    const event = {
      toolName: "bash",
      input: {
        command: `cd ${relative(repository, otherCheckout)} && git push https://github.com/${external}.git HEAD`,
      },
    };
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    approve(instance, "git push", external, `\nCommand: ${event.input.command}`);
    expect(await instance.handler(event, context(repository))).toBeUndefined();
    expect(await instance.handler(
      { toolName: "bash", input: { command: "git push origin HEAD" } },
      context(repository),
    )).toBeUndefined();
    expect(instance.messages).toHaveLength(1);
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not retain a prior checkout switch for later writes", async () => {
  const repository = checkout();
  const otherCheckout = checkout(`git@github.com:${external}.git`);
  try {
    const instance = guard();
    expect(await instance.handler(
      { toolName: "bash", input: { command: `cd ${relative(repository, otherCheckout)} && git status --short` } },
      context(repository),
    )).toBeUndefined();
    expect(await instance.handler(
      { toolName: "bash", input: { command: `git push git@github.com:${external}.git HEAD` } },
      context(repository),
    )).toMatchObject({ block: true });
    expect(instance.messages).toHaveLength(1);
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("resolves each relative tool cwd from the session checkout", async () => {
  const repository = checkout();
  try {
    mkdirSync(`${repository}/web`);
    mkdirSync(`${repository}/api`);
    const instance = guard();
    expect(await instance.handler(
      { toolName: "bash", input: { command: "git status --short", cwd: "web" } },
      context(repository),
    )).toBeUndefined();
    expect(await instance.handler(
      { toolName: "bash", input: { command: "git status --short", cwd: "api" } },
      context(repository),
    )).toBeUndefined();
    expect(await instance.handler(
      { toolName: "bash", input: { command: "git push origin HEAD" } },
      context(repository),
    )).toBeUndefined();
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not retain an explicit tool cwd for later writes", async () => {
  const repository = checkout();
  const otherCheckout = checkout(`https://github.com/${external}.git`);
  try {
    const instance = guard();
    expect(await instance.handler(
      { toolName: "bash", input: { command: "git status --short", cwd: otherCheckout } },
      context(repository),
    )).toBeUndefined();
    expect(await instance.handler(
      { toolName: "bash", input: { command: `gh issue create --repo ${current}` } },
      context(repository),
    )).toBeUndefined();
    expect(instance.messages).toHaveLength(0);
  } finally {
    rmSync(otherCheckout, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not carry pending or approved writes across session directories", async () => {
  const repository = checkout();
  const sibling = checkout();
  const event = { toolName: "bash", input: { command: `git push https://github.com/${external}.git HEAD` } };
  try {
    const pending = guard();
    expect(await pending.handler(event, context(repository))).toMatchObject({ block: true });
    expect(await pending.handler(event, context(sibling))).toMatchObject({ block: true, reason: expect.stringContaining("OMP ask") });
    expect(pending.messages).toHaveLength(2);

    const approved = guard();
    expect(await approved.handler(event, context(repository))).toMatchObject({ block: true });
    approve(approved, "git push", external, `\nCommand: ${event.input.command}`);
    expect(await approved.handler(event, context(sibling))).toMatchObject({ block: true, reason: expect.stringContaining("OMP ask") });
    expect(approved.messages).toHaveLength(2);
  } finally {
    rmSync(sibling, { recursive: true, force: true });
    rmSync(repository, { recursive: true, force: true });
  }
});

test("requires a new confirmation when an approved push changes", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const original = { toolName: "bash", input: { command: `git push https://github.com/${external}.git HEAD` } };
    const changed = { toolName: "bash", input: { command: `git push --force https://github.com/${external}.git HEAD` } };
    expect(await instance.handler(original, context(repository))).toMatchObject({ block: true });
    approve(instance, "git push", external, `\nCommand: ${original.input.command}`);
    expect(await instance.handler(changed, context(repository))).toMatchObject({
      block: true,
      reason: expect.stringContaining("OMP ask"),
    });
    expect(instance.messages).toHaveLength(2);
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

test("guards environment-prefixed external issue creation without prompting same-origin", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    const externalEvent = {
      toolName: "bash",
      input: { command: `GH_HOST=github.com gh issue create --repo ${external} --title "External report"` },
    };
    expect(await instance.handler(externalEvent, context(repository))).toMatchObject({ block: true });
    expect(instance.messages[0]).toContain("Issue title: External report");
    approve(instance, "GitHub issue creation", external, "\nIssue title: External report");
    expect(await instance.handler(externalEvent, context(repository))).toBeUndefined();
    expect(
      await instance.handler(
        { toolName: "bash", input: { command: `GH_HOST=github.com gh issue create --repo ${current}` } },
        context(repository),
      ),
    ).toBeUndefined();
    expect(instance.messages).toHaveLength(1);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("fails closed for dynamic or missing issue targets", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    for (const command of [
      'gh issue create --repo \"$TARGET\"',
      "gh issue create --repo --title malformed",
    ]) {
      const result = await instance.handler({ toolName: "bash", input: { command } }, context(repository));
      expect(result).toMatchObject({ block: true, reason: expect.stringContaining("cannot be resolved") });
    }
    expect(instance.messages).toEqual([]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("shows and safely serializes GitHub device issue titles in confirmations", async () => {
  const repository = checkout();
  const title = 'Fix "quotes"\nwithout injected instructions';
  const question = `Allow one GitHub issue creation to ${external}?\nIssue title: ${title}`;
  try {
    const instance = guard();
    const event = {
      toolName: "write",
      input: { path: "xd://github", content: JSON.stringify({ op: "issue_create", repo: external, title }) },
    };
    expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
    expect(instance.messages[0]).toContain(
      JSON.stringify({
        questions: [
          {
            id: confirmationId,
            question,
            options: [
              {
                label: "Approve",
                description: `Allow exactly this GitHub issue creation to ${external} once.`,
                preview: null,
              },
              { label: "Reject", description: "Keep this write blocked.", preview: null },
            ],
            header: "Repository boundary",
            multi: false,
          },
        ],
      }),
    );
    approve(instance, "GitHub issue creation", external, `\nIssue title: ${title}`);
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

test("guards repository-scoped pull request and API writes", async () => {
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
    ).toMatchObject({ block: true, reason: expect.stringContaining("GitHub pull request creation") });
    expect(instance.messages).toHaveLength(1);

    expect(
      repositoryMutationHandoff(
        { toolName: "bash", input: { command: `gh pr merge https://github.com/${external}/pull/1` } },
        repository,
      ),
    ).toMatchObject({ decision: "ask", action: "GitHub pull request update", target: external });
    expect(
      repositoryMutationHandoff(
        { toolName: "bash", input: { command: `gh api -XPOST repos/${external}/issues` } },
        repository,
      ),
    ).toMatchObject({ decision: "ask", action: "GitHub API write", target: external });
    expect(
      repositoryMutationHandoff(
        { toolName: "bash", input: { command: `gh pr close 1 --repo ${external}` } },
        repository,
      ),
    ).toMatchObject({ decision: "ask", action: "GitHub pull request update", target: external });
    expect(
      repositoryMutationHandoff(
        { toolName: "bash", input: { command: `gh issue lock 1 --repo ${external}` } },
        repository,
      ),
    ).toMatchObject({ decision: "ask", action: "GitHub issue update", target: external });
    expect(
      repositoryMutationHandoff(
        { toolName: "bash", input: { command: `gh api repos/${external}/issues` } },
        repository,
      ),
    ).toEqual({ decision: "allow" });
    expect(
      repositoryMutationHandoff(
        {
          toolName: "write",
          input: { path: "xd://github", content: JSON.stringify({ op: "file_read", repo: external, path: "README.md" }) },
        },
        repository,
      ),
    ).toEqual({ decision: "allow" });
    expect(
      repositoryMutationHandoff(
        { toolName: "write", input: { path: "xd://github", content: JSON.stringify({ op: "pr_push", pr: 1 }) } },
        repository,
      ),
    ).toMatchObject({ decision: "block", action: "GitHub pull request update" });
    expect(
      repositoryMutationHandoff(
        { toolName: "write", input: { path: "xd://github", content: JSON.stringify({ op: "unknown_write" }) } },
        repository,
      ),
    ).toMatchObject({ decision: "block", action: "GitHub device request" });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("permits approved target-explicit pull request and issue mutations", async () => {
  const repository = checkout();
  try {
    const instance = guard();
    for (const [command, action] of [
      [`gh pr edit 79 --repo ${external} --body "Updated"`, "GitHub pull request update"],
      [`gh pr merge 79 --repo ${external} --merge --delete-branch`, "GitHub pull request update"],
      [`gh issue close 76 --repo ${external} --comment "Resolved"`, "GitHub issue update"],
    ]) {
      const event = { toolName: "bash", input: { command } };
      expect(await instance.handler(event, context(repository))).toMatchObject({ block: true });
      approve(instance, action, external, `\nCommand: ${command}`);
      expect(await instance.handler(event, context(repository))).toBeUndefined();
    }
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("blocks targetless pull request mutations outside a GitHub checkout", () => {
  const unresolved = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  mkdirSync(unresolved);
  try {
    expect(
      repositoryMutationHandoff({ toolName: "bash", input: { command: "gh pr edit 79 --body Updated" } }, unresolved),
    ).toMatchObject({
      decision: "block",
      action: "GitHub pull request update",
      reason: expect.stringContaining("no resolvable GitHub origin"),
    });
  } finally {
    rmSync(unresolved, { recursive: true, force: true });
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

test("returns an exact external-write ask handoff", () => {
  const repository = checkout();
  try {
    const event = {
      toolName: "bash",
      input: { command: `git push https://github.com/${external}.git HEAD` },
    };
    expect(repositoryMutationHandoff(event, repository)).toMatchObject({
      decision: "ask",
      action: "git push",
      currentRepository: current,
      target: external,
      fingerprint: expect.any(String),
      ask: {
        questions: [
          {
            id: confirmationId,
            question: `Allow one git push to ${external}?\nCommand: ${event.input.command}`,
            options: [
              { label: "Approve", description: `Allow exactly this git push to ${external} once.` },
              { label: "Reject", description: "Keep this write blocked." },
            ],
          },
        ],
      },
    });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("returns a block handoff for an unresolved external target", () => {
  const repository = checkout();
  try {
    expect(
      repositoryMutationHandoff(
        { toolName: "bash", input: { command: 'gh issue create --repo "$TARGET"' } },
        repository,
      ),
    ).toMatchObject({
      decision: "block",
      action: "GitHub issue creation",
      reason: expect.stringContaining("cannot be resolved"),
    });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
