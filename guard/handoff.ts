import type { ToolCallEvent } from "../extension/contract.ts";
import { githubHandoff } from "./github-handoff.ts";
import { localHandoff } from "./local-handoff.ts";
import type { RepositoryMutationHandoff } from "./ask.ts";

export type { AskPayload, RepositoryMutationHandoff } from "./ask.ts";

export function repositoryMutationHandoff(event: ToolCallEvent, cwd: string): RepositoryMutationHandoff {
  const github = githubHandoff(event, cwd);
  if (github.decision !== "allow") return github;
  return localHandoff(event, cwd) ?? github;
}
