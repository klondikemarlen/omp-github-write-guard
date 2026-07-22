import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import type { ToolCallEvent } from "../extension/contract.ts";
import { repositoryMutationHandoff } from "../guard/handoff.ts";

function reviewThreadMutationDocument(threadId: string): string {
  return `mutation {
    resolveReviewThread(input: { threadId: "${threadId}" }) { thread { isResolved } }
  }`;
}

const fragmentFirstReviewThreadMutation = `fragment ThreadFields on PullRequestReviewThread {
  isResolved
}
mutation {
  resolveReviewThread(input: { threadId: "thread" }) { thread { ...ThreadFields } }
}`;

function withReviewThreadRepository<T>(repository: string, callback: (argumentsFile: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), "omp-github-write-guard-"));
  const executable = join(directory, "gh");
  const argumentsFile = join(directory, "arguments");
  const originalPath = process.env.PATH;
  const response = JSON.stringify({ data: { node: { pullRequest: { repository: { nameWithOwner: repository } } } } });
  writeFileSync(executable, `#!/bin/sh
printf '%s\n' "$@" > ${JSON.stringify(argumentsFile)}
printf '%s' '${response}'
`);
  chmodSync(executable, 0o755);
  process.env.PATH = `${directory}:${originalPath ?? ""}`;

  try {
    return callback(argumentsFile);
  } finally {
    process.env.PATH = originalPath;
    rmSync(directory, { recursive: true, force: true });
  }
}

function graphqlMutation(document: string, extraArguments = ""): ToolCallEvent {
  return {
    toolName: "bash",
    input: {
      command: `gh api graphql -f query=$QUERY${extraArguments}`,
      env: { QUERY: document },
    },
  };
}

function reviewThreadMutation(threadId = "thread"): ToolCallEvent {
  return graphqlMutation(reviewThreadMutationDocument(threadId));
}

test("resolves the review-thread repository before authorizing the mutation", () => {
  const handoff = withReviewThreadRepository("elsewhere/example", () => {
    return repositoryMutationHandoff(reviewThreadMutation(), process.cwd());
  });

  expect(handoff).toMatchObject({
    decision: "ask",
    action: "GitHub API write",
    target: "elsewhere/example",
  });
});

test("resolves a fragment-first review-thread mutation before authorization", () => {
  const handoff = withReviewThreadRepository("elsewhere/example", () => {
    return repositoryMutationHandoff(graphqlMutation(fragmentFirstReviewThreadMutation), process.cwd());
  });

  expect(handoff).toMatchObject({
    decision: "ask",
    action: "GitHub API write",
    target: "elsewhere/example",
  });
});

test("rejects a fragment-first mutation with a decoy repository target", () => {
  const handoff = withReviewThreadRepository("elsewhere/example", () => {
    return repositoryMutationHandoff(
      graphqlMutation(fragmentFirstReviewThreadMutation, " -f dummy=/repos/klondikemarlen/omp-github-write-guard"),
      process.cwd(),
    );
  });

  expect(handoff).toMatchObject({
    decision: "block",
    action: "GitHub API write",
  });
});

test("forwards @-prefixed thread IDs literally", () => {
  const argumentsList = withReviewThreadRepository("elsewhere/example", (argumentsFile) => {
    repositoryMutationHandoff(reviewThreadMutation("@thread"), process.cwd());
    return readFileSync(argumentsFile, "utf8").trim().split("\n");
  });

  expect(argumentsList).toContain("-f");
  expect(argumentsList).toContain("threadId=@thread");
  expect(argumentsList).not.toContain("-F");
});
