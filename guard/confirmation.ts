import type { ToolInput } from "../extension/contract.ts";
import type { GitHubWrite } from "../github/write.ts";

export const confirmationQuestionId = "confirm_external_github_write";
const approveWrite = "Approve";

export function confirmationQuestion(write: GitHubWrite, target: string, input: ToolInput): string {
  const description =
    write.description ? `\n${write.description}` :
    typeof input.command === "string" ? `\nCommand: ${input.command}` :
    "";
  return `Allow one ${write.action} to ${target}?${description}`;
}

export function isApprovedConfirmation(input: ToolInput, details: unknown, expectedQuestion: string): boolean {
  const questions = input.questions;
  if (!Array.isArray(questions) || questions.length !== 1) return false;

  const question = questions[0];
  return (
    typeof question === "object" &&
    question !== null &&
    "id" in question &&
    "question" in question &&
    question.id === confirmationQuestionId &&
    question.question === expectedQuestion &&
    typeof details === "object" &&
    details !== null &&
    "selectedOptions" in details &&
    Array.isArray(details.selectedOptions) &&
    details.selectedOptions.includes(approveWrite)
  );
}

export function authorizationKey(action: string, target: string, input: ToolInput, context: string): string {
  const entries = Object.entries(input).sort(([left], [right]) => left.localeCompare(right));
  return `${action}\u0000${target}\u0000${context}\u0000${JSON.stringify(entries)}`;
}
