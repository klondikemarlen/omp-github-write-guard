import type { ToolInput } from "../extension/contract.ts";
import { normalizeRepository } from "./repository.ts";
import type { GitHubWrite } from "./write.ts";

type Operation = { action: string; title?: string; requiresTarget?: boolean };
const READ_OPERATIONS: Record<string, true> = {
  pr_checkout: true, repo_view: true, run_watch: true, search_code: true, search_commits: true,
  search_issues: true, search_prs: true, file_read: true, search_repos: true,
};
const WRITE_OPERATIONS: Record<string, Operation> = {
  issue_create: { action: "GitHub issue creation", title: "Issue title" },
  issue_comment: { action: "GitHub issue update" },
  pr_create: { action: "GitHub pull request creation", title: "Pull request title" },
  pr_comment: { action: "GitHub pull request update" },
  pr_push: { action: "GitHub pull request update", requiresTarget: true },
};

function repositoryReference(value: unknown): string | undefined {
  if (typeof value !== "string") return normalizeRepository(value);
  const match = value.match(/github\.com[/:]([^/\s]+)\/([^/\s]+)/i);
  return normalizeRepository(value) ?? (match ? normalizeRepository(`${match[1]}/${match[2]}`) : undefined);
}

export function githubDeviceWrite(input: ToolInput): GitHubWrite | undefined {
  if (input.path !== "xd://github" || typeof input.content !== "string") return undefined;
  try {
    const request = JSON.parse(input.content) as Record<string, unknown>;
    if (typeof request.op !== "string") return { action: "GitHub device request", targetUnresolved: true };
    if (READ_OPERATIONS[request.op]) return undefined;

    const operation = WRITE_OPERATIONS[request.op];
    if (!operation) return { action: "GitHub device request", targetUnresolved: true };
    const target = repositoryReference(request.repo) ?? repositoryReference(request.pr);
    const hasTarget = request.repo !== undefined || request.pr !== undefined;
    return {
      action: operation.action,
      target,
      targetUnresolved: (hasTarget && !target) || (operation.requiresTarget && !target),
      description: operation.title && typeof request.title === "string" ? `${operation.title}: ${request.title}` : undefined,
    };
  } catch {
    return { action: "GitHub device request", targetUnresolved: true };
  }
}
