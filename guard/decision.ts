import type { GitHubWrite } from "../github/write.ts";

export type GuardDecision =
  | { allow: true }
  | { allow: false; action: GitHubWrite["action"]; target: string; reason: string };

export function guardDecision(
  write: GitHubWrite | undefined,
  currentRepository?: string,
  defaultRepository = currentRepository,
): GuardDecision {
  if (!write || write.targetUnresolved || !currentRepository) return { allow: true };
  const target = write.target ?? defaultRepository;
  if (!target) return { allow: true };
  return target === currentRepository
    ? { allow: true }
    : { action: write.action, allow: false, target, reason: `the target differs from the current checkout (${currentRepository})` };
}
