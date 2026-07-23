import type { ToolResultEvent } from "./contract.ts";
import { isApprovedConfirmation } from "../guard/approved-confirmation.ts";

export type AuthorizationResult = "authorized" | "missing" | "mismatched";

export class AuthorizationState {
  #pending: { key: string; question: string } | undefined;
  #authorizedKey: string | undefined;
  #sessionDirectory: string | undefined;

  resetFor(directory: string): void {
    if (this.#sessionDirectory === directory) return;
    this.#sessionDirectory = directory;
    this.#pending = undefined;
    this.#authorizedKey = undefined;
  }

  record(event: ToolResultEvent): void {
    if (event.toolName !== "ask" || !this.#pending) return;

    const pending = this.#pending;
    this.#pending = undefined;
    if (!event.isError && isApprovedConfirmation(event.input, event.details, pending.question)) {
      this.#authorizedKey = pending.key;
    }
  }

  consume(key: string): AuthorizationResult {
    const authorizedKey = this.#authorizedKey;
    this.#authorizedKey = undefined;
    if (!authorizedKey) return "missing";
    return authorizedKey === key ? "authorized" : "mismatched";
  }

  begin(key: string, question: string): boolean {
    if (this.#pending) return false;
    this.#pending = { key, question };
    return true;
  }
}
