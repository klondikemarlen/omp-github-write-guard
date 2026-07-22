import { execFileSync } from "node:child_process";

import { normalizeRepository } from "./normalize-repository.ts";

const REVIEW_THREAD_REPOSITORY_QUERY = `query($threadId: ID!) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      pullRequest {
        repository { nameWithOwner }
      }
    }
  }
}`;

type GraphQLRequest = (threadId: string) => string | undefined;

type ReviewThreadResponse = {
  data?: {
    node?: {
      pullRequest?: {
        repository?: {
          nameWithOwner?: unknown;
        };
      };
    };
  };
};

function githubGraphql(threadId: string): string | undefined {
  try {
    return execFileSync(
      "gh",
      [
        "api",
        "graphql",
        "-f",
        `query=${REVIEW_THREAD_REPOSITORY_QUERY}`,
        "-f",
        `threadId=${threadId}`,
      ],
      { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 },
    );
  } catch {
    return undefined;
  }
}

export function reviewThreadRepository(threadId: string, request: GraphQLRequest = githubGraphql): string | undefined {
  try {
    const response = JSON.parse(request(threadId) ?? "") as ReviewThreadResponse;
    return normalizeRepository(response.data?.node?.pullRequest?.repository?.nameWithOwner);
  } catch {
    return undefined;
  }
}
