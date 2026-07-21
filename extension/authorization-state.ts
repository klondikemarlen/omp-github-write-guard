import type { ToolResultEvent } from "./contract.ts";
import { isApprovedConfirmation } from "../guard/approved-confirmation.ts";

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

  consume(key: string): boolean {
    if (this.#authorizedKey !== key) {
      this.#authorizedKey = undefined;
      return false;
    }
    this.#authorizedKey = undefined;
    return true;
  }

  begin(key: string, question: string): boolean {
    if (this.#pending) return false;
    this.#pending = { key, question };
    return true;
  }
}
