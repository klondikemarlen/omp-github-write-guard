import type { ToolInput } from "../extension/contract.ts";
import { confirmationQuestionId } from "./confirmation-question.ts";

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
    details.selectedOptions.includes("Approve")
  );
}
