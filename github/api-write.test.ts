import { expect, test } from "bun:test";

import { githubApiWrite } from "./api-write.ts";
import { reviewThreadRepository } from "./review-thread-repository.ts";

function graphqlWrite(document: string) {
  return githubApiWrite(["gh", "api", "graphql", "-f", `query=${document}`], 2, { command: "gh api graphql" });
}

test("does not guard a repository-scoped GraphQL review lookup", () => {
  const lookup = `query {
    repository(owner: "owner", name: "repository") {
      pullRequest(number: 1) { reviewThreads(first: 1) { nodes { id } } }
    }
  }`;
  const write = githubApiWrite(["gh", "api", "graphql", "-f", "query=", undefined], 2, {
    command: "gh api graphql -f query=$QUERY",
    env: { QUERY: lookup },
  });

  expect(write).toBeUndefined();
});

test("fails closed when another command has an environment-backed GraphQL query", () => {
  const write = githubApiWrite(["gh", "api", "graphql", "-f", "query=", undefined], 2, {
    command: "gh api graphql -f query=$READ && gh api graphql -f query=$WRITE",
    env: {
      READ: "query { viewer { login } }",
      WRITE: "mutation { resolveReviewThread(input: { threadId: \"thread\" }) { thread { id } } }",
    },
  });

  expect(write).toMatchObject({ action: "GitHub API write", targetUnresolved: true });
});

test("requires one environment-backed GraphQL query variable", () => {
  const write = githubApiWrite(["gh", "api", "graphql", "-f", "query=", undefined, "-f", "query=", undefined], 2, {
    command: "gh api graphql -f query=$READ -f query=$WRITE",
    env: {
      READ: "query { viewer { login } }",
      WRITE: "mutation { resolveReviewThread(input: { threadId: \"thread\" }) { thread { id } } }",
    },
  });

  expect(write).toMatchObject({ action: "GitHub API write", targetUnresolved: true });
});

test("identifies one executable review-thread mutation", () => {
  const write = graphqlWrite(`mutation ResolveThread @skip(if: false) {
    # resolveReviewThread(input: { threadId: "comment" })
    resolved: resolveReviewThread(input: { threadId: "thread" }) @skip(if: false) { thread { isResolved } }
  }`);

  expect(write).toMatchObject({ reviewThreadId: "thread", targetUnresolved: false });
});

test("ignores review-thread text in GraphQL strings and comments", () => {
  const write = graphqlWrite(`mutation @skip(if: false) {
    updatePullRequest(input: { body: "resolveReviewThread(input: { threadId: \\"string\\" })" }) { pullRequest { id } }
    # resolveReviewThread(input: { threadId: "comment" })
  }`);

  expect(write).toMatchObject({ targetUnresolved: true });
  expect(write?.reviewThreadId).toBeUndefined();
  expect(write?.reviewThreadUnresolved).toBeUndefined();
});

test("fails closed for ambiguous or unlexable review-thread mutations", () => {
  const ambiguous = graphqlWrite(`mutation {
    resolveReviewThread(input: { threadId: "first" }) { thread { id } }
    resolveReviewThread(input: { threadId: "second" }) { thread { id } }
  }`);
  const sibling = graphqlWrite(`mutation {
    resolveReviewThread(input: { threadId: "thread" }) { thread { id } }
    deleteIssue(input: { issueId: "issue" }) { clientMutationId }
  }`);
  const multipleOperations = graphqlWrite(`mutation First {
    resolveReviewThread(input: { threadId: "first" }) { thread { id } }
  }
  mutation Second {
    resolveReviewThread(input: { threadId: "second" }) { thread { id } }
  }`);
  const unlexable = graphqlWrite(`mutation {
    resolveReviewThread(input: { threadId: "thread" }) { thread { id } } ~
  }`);

  expect(ambiguous).toMatchObject({ reviewThreadUnresolved: true });
  expect(ambiguous?.reviewThreadId).toBeUndefined();
  expect(sibling).toMatchObject({ reviewThreadUnresolved: true });
  expect(sibling?.reviewThreadId).toBeUndefined();
  expect(multipleOperations).toMatchObject({ reviewThreadUnresolved: true });
  expect(multipleOperations?.reviewThreadId).toBeUndefined();
  expect(unlexable).toMatchObject({ reviewThreadUnresolved: true });
  expect(unlexable?.reviewThreadId).toBeUndefined();
});

test("resolves a review thread to its canonical repository", () => {
  const repository = reviewThreadRepository("thread", (threadId) => {
    expect(threadId).toBe("thread");
    return JSON.stringify({ data: { node: { pullRequest: { repository: { nameWithOwner: "Owner/Repository" } } } } });
  });

  expect(repository).toBe("owner/repository");
});

test("rejects incomplete and failed review-thread lookups", () => {
  const incomplete = reviewThreadRepository("thread", () => JSON.stringify({ data: { node: {} } }));
  const failed = reviewThreadRepository("thread", () => {
    throw new Error("lookup failed");
  });

  expect(incomplete).toBeUndefined();
  expect(failed).toBeUndefined();
});
