import { executableIndex } from "../shell/executable-index.ts";
import { githubApiWrite } from "./api-write.ts";
import { githubTarget } from "./target.ts";
import type { GitHubWrite } from "./write.ts";

type Operation = { action: string; title?: string };
const OPERATIONS: Record<string, Operation> = {
  "issue create": { action: "GitHub issue creation", title: "Issue title" },
  "issue edit": { action: "GitHub issue update" },
  "issue close": { action: "GitHub issue update" },
  "issue reopen": { action: "GitHub issue update" },
  "issue delete": { action: "GitHub issue update" },
  "issue comment": { action: "GitHub issue update" },
  "issue lock": { action: "GitHub issue update" },
  "issue unlock": { action: "GitHub issue update" },
  "issue pin": { action: "GitHub issue update" },
  "issue unpin": { action: "GitHub issue update" },
  "pr create": { action: "GitHub pull request creation", title: "Pull request title" },
  "pr edit": { action: "GitHub pull request update" },
  "pr merge": { action: "GitHub pull request update" },
  "pr close": { action: "GitHub pull request update" },
  "pr reopen": { action: "GitHub pull request update" },
  "pr comment": { action: "GitHub pull request update" },
  "pr review": { action: "GitHub pull request update" },
  "pr ready": { action: "GitHub pull request update" },
  "pr lock": { action: "GitHub pull request update" },
  "pr unlock": { action: "GitHub pull request update" },
};

export function githubCliWrite(words: (string | undefined)[]): GitHubWrite | undefined {
  const index = executableIndex(words);
  if (words[index] !== "gh") return undefined;
  if (words[index + 1] === "api") return githubApiWrite(words, index + 2);

  const operation = OPERATIONS[`${words[index + 1]} ${words[index + 2]}`];
  return operation ? { action: operation.action, ...githubTarget(words, index + 3, operation.title) } : undefined;
}
