import type { ToolInput } from "../extension/contract.ts";
import type { GitHubWrite } from "../github/write.ts";

export const confirmationQuestionId = "confirm_external_github_write";

export function confirmationQuestion(write: GitHubWrite, target: string, input: ToolInput): string {
  const description =
    write.description ? `\n${write.description}` :
    typeof input.command === "string" ? `\nCommand: ${input.command}` :
    "";
  return `Allow one ${write.action} to ${target}?${description}`;
}
