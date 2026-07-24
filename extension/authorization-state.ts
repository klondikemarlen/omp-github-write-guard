import type { ToolResultEvent } from "./contract.ts";
import { approvedExternalQuestion, isApprovedConfirmation, isApprovedExternalConfirmation } from "../guard/approved-confirmation.ts";

export type AuthorizationResult = "authorized" | "missing" | "mismatched";

export class AuthorizationState {
  #pending: { key: string; question: string } | undefined;
  #authorizedKey: string | undefined;
  #externalQuestion: string | undefined;
  #sessionDirectory: string | undefined;

  resetFor(directory: string): void {
    if (this.#sessionDirectory === undefined) {
      this.#sessionDirectory = directory;
      return;
    }
    if (this.#sessionDirectory === directory) return;
    this.#sessionDirectory = directory;
    this.#pending = undefined;
    this.#authorizedKey = undefined;
    this.#externalQuestion = undefined;
  }

  record(event: ToolResultEvent): void {
    if (event.toolName !== "ask" || event.isError) return;

    const pending = this.#pending;
    const externalQuestion = approvedExternalQuestion(event.input, event.details);
    if (!pending) {
      if (externalQuestion) this.#externalQuestion = externalQuestion;
      return;
    }

    this.#pending = undefined;
    if (isApprovedConfirmation(event.input, event.details, pending.question)) {
      this.#authorizedKey = pending.key;
    } else if (externalQuestion && isApprovedExternalConfirmation(event.input, event.details, pending.question)) {
      this.#externalQuestion = externalQuestion;
    }
  }

  consume(key: string): AuthorizationResult {
    const authorizedKey = this.#authorizedKey;
    this.#authorizedKey = undefined;
    if (!authorizedKey) return "missing";
    return authorizedKey === key ? "authorized" : "mismatched";
  }

  consumeExternal(question: string): boolean {
    if (!this.#externalQuestion) return false;
    const storedEnd = this.#externalQuestion.indexOf("\n");
    const expectedEnd = question.indexOf("\n");
    if (
      this.#externalQuestion.slice(0, storedEnd < 0 ? this.#externalQuestion.length : storedEnd) !==
      question.slice(0, expectedEnd < 0 ? question.length : expectedEnd)
    ) return false;
    const storedDetails = this.#externalQuestion
      .split("\n")
      .slice(1)
      .filter((line) => !line.startsWith("Current repository:") && !line.startsWith("Target repository:"));
    const expectedDetails = question
      .split("\n")
      .slice(1)
      .filter((line) => !line.startsWith("Current repository:") && !line.startsWith("Target repository:"));
    if (storedDetails.join("\n") !== expectedDetails.join("\n")) return false;
    this.#externalQuestion = undefined;
    return true;
  }

  begin(key: string, question: string): boolean {
    if (this.#pending) return false;
    this.#pending = { key, question };
    return true;
  }
}
