import type { ToolCallEvent } from "../extension/contract.ts";
import { askHandoff, type RepositoryMutationHandoff } from "./ask.ts";
import { localMutation } from "./local-mutation.ts";

export function localHandoff(event: ToolCallEvent, cwd: string): RepositoryMutationHandoff | undefined {
  const mutation = localMutation(event, cwd);
  return mutation
    ? askHandoff(mutation.action, mutation.targets.join(", "), event, mutation.boundary, "local")
    : undefined;
}
