import type { ToolInput } from "../extension/contract.ts";
import type { BoundaryCategory } from "./policy.ts";

export const confirmationQuestionId = "confirm_repository_boundary_mutation";

export function confirmationQuestion(
  action: string,
  target: string,
  input: ToolInput,
  description: string | undefined,
  currentRepository: string | undefined,
  category: BoundaryCategory,
): string {
  const local = category === "local";
  const details = [
    local ? `Target path(s): ${target}` : `Current repository: ${currentRepository ?? "unresolved"}`,
    local ? undefined : `Target repository: ${target}`,
    description,
    typeof input.command === "string" ? `Command: ${input.command}` : undefined,
  ].filter((detail): detail is string => Boolean(detail));
  return `Allow one ${action} to ${target}?${details.map((detail) => `\n${detail}`).join("")}`;
}
