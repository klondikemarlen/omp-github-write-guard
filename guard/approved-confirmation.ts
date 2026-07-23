import type { ToolInput } from "../extension/contract.ts";
import { confirmationQuestionId } from "./confirmation-question.ts";

export const externalConfirmationQuestionId = "confirm_external_github_write";

export function approvedExternalQuestion(input: ToolInput, details: unknown): string | undefined {
  const questions = input.questions;
  if (!Array.isArray(questions) || questions.length !== 1) return undefined;
  const question = questions[0];
  if (
    typeof question !== "object" ||
    question === null ||
    !("id" in question) ||
    !("question" in question) ||
    question.id !== externalConfirmationQuestionId ||
    typeof question.question !== "string" ||
    typeof details !== "object" ||
    details === null ||
    !("selectedOptions" in details) ||
    !Array.isArray(details.selectedOptions) ||
    !details.selectedOptions.includes("Approve")
  ) return undefined;
  return question.question;
}
export function isApprovedExternalConfirmation(input: ToolInput, details: unknown, expectedQuestion: string): boolean {
  const question = approvedExternalQuestion(input, details);
  if (!question) return false;
  const questionEnd = question.indexOf("\n");
  const expectedEnd = expectedQuestion.indexOf("\n");
  return question.slice(0, questionEnd < 0 ? question.length : questionEnd) ===
    expectedQuestion.slice(0, expectedEnd < 0 ? expectedQuestion.length : expectedEnd);
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
    details.selectedOptions.includes("Approve")
  );
}
