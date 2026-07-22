import type { ToolInput } from "../extension/contract.ts";

export const confirmationQuestionId = "confirm_repository_boundary_mutation";

export function confirmationQuestion(action: string, target: string, input: ToolInput, description?: string): string {
  const detail =
    description ? `\n${description}` :
    typeof input.command === "string" ? `\nCommand: ${input.command}` :
    "";
  return `Allow one ${action} to ${target}?${detail}`;
}
