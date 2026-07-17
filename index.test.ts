import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

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
  issueCreationPolicies: { [owned]: "allow" },
  pullRequestCreationPolicies: {},
};

function githubOperation(op: string, repo: string) {
  return { path: "xd://github", content: JSON.stringify({ op, repo }) };
}

function hookHandler(guardPolicy = policy) {
  let handler: ToolCallHandler | undefined;
  createGitHubWriteGuard(guardPolicy)({
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
  const malformed = JSON.parse('{"issueCreationPolicies":{"acme/example":"ask"}}') as GuardPolicy;

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

test("loads the stable local policy path when no environment override exists", async () => {
  const homeDirectory = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  const path = `${homeDirectory}/.omp/agent/github-write-guard.json`;
  const override = process.env.OMP_GITHUB_WRITE_GUARD_CONFIG;
  mkdirSync(`${homeDirectory}/.omp/agent`, { recursive: true });
  await Bun.write(path, JSON.stringify(policy));
  delete process.env.OMP_GITHUB_WRITE_GUARD_CONFIG;
  try {
    expect(loadPolicy(undefined, homeDirectory)).toEqual(policy);
  } finally {
    if (override === undefined) delete process.env.OMP_GITHUB_WRITE_GUARD_CONFIG;
    else process.env.OMP_GITHUB_WRITE_GUARD_CONFIG = override;
    rmSync(homeDirectory, { recursive: true });
  }
});

test("prefers an explicit policy path over the stable local path", async () => {
  const homeDirectory = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  const stablePath = `${homeDirectory}/.omp/agent/github-write-guard.json`;
  const explicitPath = `${homeDirectory}/override.json`;
  const explicitPolicy = { issueCreationPolicies: { "override/example": "allow" } };
  mkdirSync(`${homeDirectory}/.omp/agent`, { recursive: true });
  await Bun.write(stablePath, JSON.stringify(policy));
  await Bun.write(explicitPath, JSON.stringify(explicitPolicy));
  try {
    expect(loadPolicy(explicitPath, homeDirectory)).toEqual(explicitPolicy);
  } finally {
    rmSync(homeDirectory, { recursive: true });
  }
});
test("prefers plugin UI settings over local policy and fails closed for malformed UI values", async () => {
  const homeDirectory = `/tmp/omp-github-write-guard-${crypto.randomUUID()}`;
  const stablePath = `${homeDirectory}/.omp/agent/github-write-guard.json`;
  const pluginSettingsPath = `${homeDirectory}/.omp/plugins/omp-plugins.lock.json`;
  mkdirSync(`${homeDirectory}/.omp/agent`, { recursive: true });
  mkdirSync(`${homeDirectory}/.omp/plugins`, { recursive: true });
  await Bun.write(
    stablePath,
    JSON.stringify({
      issueCreationPolicies: { [owned]: "allow" },
      pullRequestCreationPolicies: { [external]: "allow" },
    }),
  );
  await Bun.write(
    pluginSettingsPath,
    JSON.stringify({
      settings: {
        "omp-github-write-guard": { issueCreationPolicies: JSON.stringify({ [owned]: "confirm" }) },
      },
    }),
  );
  try {
    expect(loadPolicy(stablePath, homeDirectory, pluginSettingsPath)).toEqual({
      issueCreationPolicies: { [owned]: "confirm" },
      pullRequestCreationPolicies: { [external]: "allow" },
    });

    await Bun.write(
      pluginSettingsPath,
      JSON.stringify({ settings: { "omp-github-write-guard": { issueCreationPolicies: "not JSON" } } }),
    );
    expect(guardDecision({ command: `gh issue create --repo ${owned}` }, loadPolicy(stablePath, homeDirectory, pluginSettingsPath), current)).toMatchObject({
      allow: false,
      requiresConfirmation: true,
    });
  } finally {
    rmSync(homeDirectory, { recursive: true });
  }
});

test("applies independent issue and pull-request creation policies", () => {
  expect(guardDecision({ command: `gh issue create --repo ${owned}` }, policy, current)).toEqual({ allow: true });
  expect(guardDecision({ command: `gh pr create --repo ${owned}` }, policy, current)).toMatchObject({
    allow: false,
    requiresConfirmation: true,
    target: owned,
  });
  expect(guardDecision({ command: `gh issue create --repo ${external}` }, policy, current)).toMatchObject({
    allow: false,
    requiresConfirmation: true,
    target: external,
  });
  expect(guardDecision({ command: `gh pr create --repo ${external}` }, policy, current)).toMatchObject({
    allow: false,
    requiresConfirmation: true,
    target: external,
  });

  const pullRequestPolicy = { pullRequestCreationPolicies: { [external]: "allow" } };
  expect(guardDecision({ command: `gh pr create --repo ${external}` }, pullRequestPolicy, current)).toEqual({
    allow: true,
  });
});

test("always allows issue and pull-request creation in the current project", () => {
  const confirmCurrent = {
    issueCreationPolicies: { [current]: "confirm" },
    pullRequestCreationPolicies: { [current]: "confirm" },
  };

  expect(guardDecision({ command: "gh issue create" }, confirmCurrent, current)).toEqual({ allow: true });
  expect(guardDecision({ command: `gh pr create --repo ${current}` }, confirmCurrent, current)).toEqual({
    allow: true,
  });
  expect(guardDecision(githubOperation("issue_create", current), confirmCurrent, current)).toEqual({ allow: true });
  expect(guardDecision(githubOperation("pr_create", current), confirmCurrent, current)).toEqual({ allow: true });
});

test("confirms malformed GitHub-device targets instead of treating them as current-project writes", () => {
  expect(
    guardDecision({ path: "xd://github", content: JSON.stringify({ op: "pr_create" }) }, {}, current),
  ).toEqual({ allow: true });
  expect(
    guardDecision({ path: "xd://github", content: JSON.stringify({ op: "pr_create", repo: "" }) }, {}, current),
  ).toMatchObject({ allow: false, requiresConfirmation: true, unresolvedTarget: true });
});

test("applies the creation policies to GitHub-tool operations", () => {
  expect(guardDecision(githubOperation("issue_create", owned), policy, current)).toEqual({ allow: true });
  expect(guardDecision(githubOperation("pr_create", owned), policy, current)).toMatchObject({
    allow: false,
    requiresConfirmation: true,
    target: owned,
  });
  expect(
    guardDecision(githubOperation("pr_create", external), { pullRequestCreationPolicies: { [external]: "allow" } }, current),
  ).toEqual({ allow: true });
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

test("presents an informative, menu-confirmed creation choice", async () => {
  let prompt = "";
  let title = "";
  const result = await hookHandler()(
    { toolName: "bash", input: { command: `gh pr create --repo ${owned}` } },
    {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        confirm: (receivedTitle, message) => {
          title = receivedTitle;
          prompt = message;
          return true;
        },
      },
    },
  );

  expect(result).toBeUndefined();
  expect(prompt).toBe(
    `You are in ${current}. Create pull request will create a GitHub artifact in ${owned}. ` +
      "Choose an option because this is a different project. " +
      "Approval is remembered for this action and target for the rest of this session. " +
      "the creation policy requires confirmation.",
  );
  expect(title).toBe("Choose GitHub write action");
});

test("does not prompt same-project creation", async () => {
  let confirmations = 0;
  const result = await hookHandler({})(
    { toolName: "bash", input: { command: "gh issue create" } },
    { cwd: process.cwd(), hasUI: true, ui: { confirm: () => ++confirmations > 0 } },
  );
  expect(result).toBeUndefined();
  expect(confirmations).toBe(0);
});

test("remembers only confirmed resolved creation requests", async () => {
  let confirmations = 0;
  const handler = hookHandler();
  const context = {
    cwd: process.cwd(),
    hasUI: true,
    ui: {
      confirm: () => ++confirmations > 1,
    },
  };

  expect(await handler({ toolName: "bash", input: { command: `gh pr create --repo ${owned}` } }, context)).toMatchObject({
    block: true,
  });
  expect(await handler({ toolName: "bash", input: { command: `gh pr create --repo ${owned}` } }, context)).toBeUndefined();
  expect(await handler({ toolName: "bash", input: { command: `gh pr create --repo ${owned}` } }, context)).toBeUndefined();
  expect(await handler({ toolName: "bash", input: { command: `gh issue close 1 --repo ${owned}` } }, context)).toBeUndefined();
  expect(await handler({ toolName: "bash", input: { command: `gh issue close 1 --repo ${owned}` } }, context)).toBeUndefined();

  expect(confirmations).toBe(4);
});


test("keeps confirmed creation approvals scoped to action and target", async () => {
  let confirmations = 0;
  const handler = hookHandler({});
  const context = {
    cwd: process.cwd(),
    hasUI: true,
    ui: {
      confirm: () => {
        confirmations++;
        return true;
      },
    },
  };

  await handler({ toolName: "bash", input: { command: `gh pr create --repo ${owned}` } }, context);
  await handler({ toolName: "bash", input: { command: `gh pr create --repo ${owned}` } }, context);
  await handler({ toolName: "bash", input: { command: "gh pr create --repo acme/other" } }, context);
  await handler({ toolName: "bash", input: { command: `gh issue create --repo ${owned}` } }, context);

  expect(confirmations).toBe(3);
});

test("does not remember unresolved targets", async () => {
  let confirmations = 0;
  const handler = hookHandler();
  const context = {
    cwd: "/tmp",
    hasUI: true,
    ui: {
      confirm: () => {
        confirmations++;
        return true;
      },
    },
  };

  await handler({ toolName: "bash", input: { command: 'gh pr create --repo ""' } }, context);
  await handler({ toolName: "bash", input: { command: 'gh pr create --repo ""' } }, context);

  expect(confirmations).toBe(2);
});

test("prompts instead of hard-blocking pull requests", async () => {
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

  expect(result).toBeUndefined();
  expect(confirmations).toBe(1);
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

    expect(currentCheckoutRepository(worktree)).toBe(owned);
    let confirmations = 0;
    const result = await hookHandler({ pullRequestCreationPolicies: { [owned]: "allow" } })(
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
