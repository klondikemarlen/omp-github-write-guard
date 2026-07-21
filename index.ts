export { createGitHubWriteGuard } from "./extension/create-guard.ts";
export type {
  ExtensionAPI,
  HookContext,
  ToolCallEvent,
  ToolCallHandler,
  ToolCallResult,
  ToolInput,
  ToolResultEvent,
  ToolResultHandler,
} from "./extension/contract.ts";
export { currentCheckoutRepository } from "./git/current-checkout.ts";
export { guardDecision, type GuardDecision } from "./guard/decision.ts";
export {
  githubWriteHandoff,
  type AskPayload,
  type GitHubWriteHandoff,
} from "./guard/handoff.ts";

import { createGitHubWriteGuard } from "./extension/create-guard.ts";

export default createGitHubWriteGuard();
