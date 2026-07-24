import type { ExtensionAPI, ToolCallResult } from "./contract.ts";
import { AuthorizationState } from "./authorization-state.ts";
import { repositoryMutationHandoff } from "../guard/handoff.ts";

export function createRepositoryBoundaryGuard(): (pi: ExtensionAPI) => void {
  return (pi) => {
    const authorization = new AuthorizationState();
    pi.on("tool_result", (event) => authorization.record(event));
    pi.on("tool_call", (event, context): ToolCallResult => {
      authorization.resetFor(context.cwd);
      const handoff = repositoryMutationHandoff(event, context.cwd);
      if (handoff.decision === "allow") return;

      const reason = `Blocked ${handoff.action} targeting ${handoff.target}: confirmation is required.`;
      if (!context.hasUI) return;

      const authorizationResult = authorization.consume(handoff.fingerprint);
      if (authorizationResult === "authorized") return;
      const question = handoff.ask.questions[0].question;
      if (authorization.consumeExternal(handoff.fingerprint, question)) return;
      const authorizationDetail =
        authorizationResult === "mismatched"
          ? " An approval exists but does not match this exact retry."
          : " No matching approval was recorded.";
      if (!authorization.begin(handoff.fingerprint, question)) {
        return { block: true, reason: `${reason}${authorizationDetail} A confirmation is already pending.` };
      }
      pi.sendUserMessage(
        `Call the ask tool now with this exact payload: ${JSON.stringify(handoff.ask)}. If approved, retry exactly the blocked ${handoff.action}; otherwise stop.`,
        { deliverAs: "steer" },
      );
      return { block: true, reason: `${reason}${authorizationDetail} OMP ask confirmation requested.` };
    });
  };
}
