import type { ToolInput } from "../extension/contract.ts";

export const confirmationQuestionId = "confirm_repository_boundary_mutation";

export function confirmationQuestion(
  action: string,
  target: string,
  input: ToolInput,
  description?: string,
  currentRepository?: string,
): string {
  const details = [
    `Current repository: ${currentRepository ?? "unresolved"}`,
    `Target repository: ${target}`,
    description,
    typeof input.command === "string" ? `Command: ${input.command}` : undefined,
  ].filter((detail): detail is string => Boolean(detail));
  return `Allow one ${action} to ${target}?${details.map((detail) => `\n${detail}`).join("")}`;
}
