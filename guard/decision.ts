import type { GitHubWrite } from "../github/write.ts";

export type GuardDecision =
  | { allow: true }
  | { allow: false; action: GitHubWrite["action"]; target?: string; reason: string };

export function guardDecision(
  write: GitHubWrite | undefined,
  currentRepository?: string,
  defaultRepository = currentRepository,
): GuardDecision {
  if (!write) return { allow: true };

  const target = write.targetUnresolved ? undefined : write.target ?? defaultRepository;
  const blocked = (reason: string): GuardDecision => ({ action: write.action, allow: false, target, reason });

  if (!currentRepository) return blocked("the current checkout has no resolvable GitHub origin repository");
  if (!target) return blocked("the GitHub target cannot be resolved");
  return target === currentRepository
    ? { allow: true }
    : blocked(`the target differs from the current checkout (${currentRepository})`);
}
