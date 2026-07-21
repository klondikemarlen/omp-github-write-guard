import { resolve } from "node:path";

import type { ToolCallEvent } from "../extension/contract.ts";
import { currentCheckoutRepository } from "../git/current-checkout.ts";
import { defaultPushRemote } from "../git/default-push-remote.ts";
import { pushRepository } from "../git/push-repository.ts";
import { remoteRepository } from "../github/remote-repository.ts";
import { gitPushWrite } from "../git/push-write.ts";
import { recognizedGitHubWrite } from "../github/recognized-write.ts";
import type { GitHubWrite } from "../github/write.ts";
import { toolDirectory } from "../shell/directory.ts";
import { shellCommands } from "../shell/commands.ts";
import { authorizationKey } from "./authorization-key.ts";
import { confirmationQuestion, confirmationQuestionId } from "./confirmation-question.ts";
import { guardDecision } from "./decision.ts";

export type AskPayload = {
  questions: [{
    id: string;
    question: string;
    options: { label: string; description: string; preview: null }[];
    header: string;
    multi: false;
  }];
};

export type GitHubWriteHandoff =
  | { decision: "allow"; action?: GitHubWrite["action"]; currentRepository?: string; target?: string }
  | { decision: "ask"; action: string; currentRepository?: string; target: string; fingerprint: string; ask: AskPayload }
  | { decision: "block"; action: string; currentRepository?: string; target?: string; reason: string };

function writeFor(event: ToolCallEvent): GitHubWrite | undefined {
  if (event.toolName === "write") return recognizedGitHubWrite(event.input);
  if (event.toolName !== "bash" || typeof event.input.command !== "string") return undefined;

  const writes = shellCommands(event.input.command)
    .map((words) => gitPushWrite(words) ?? recognizedGitHubWrite(event.input, words))
    .filter((write): write is GitHubWrite => write !== undefined);
  if (writes.length === 1) return writes[0];
  return writes.length > 1 ? { action: "GitHub write", targetUnresolved: true } : undefined;
}

export function githubWriteHandoff(event: ToolCallEvent, cwd: string): GitHubWriteHandoff {
  const write = writeFor(event);
  if (!write) return { decision: "allow" };

  const inputDirectory = toolDirectory(event.input, cwd);
  const toolCwd = inputDirectory ?? cwd;
  const commandCwd = write.directories?.reduce((directoryCwd, directory) => resolve(directoryCwd, directory), toolCwd) ?? toolCwd;
  if (write.action === "git push" && !write.targetUnresolved) {
    const remote = write.remote ?? defaultPushRemote(commandCwd);
    write.target = remoteRepository(remote) ?? pushRepository(commandCwd, remote);
    write.targetUnresolved = !write.target;
  }
  if (write.action !== "git push" && !write.target && !write.targetUnresolved) {
    write.target = currentCheckoutRepository(commandCwd);
  }

  const currentRepository = currentCheckoutRepository(commandCwd);
  const decision = guardDecision(write, currentRepository);
  if (decision.allow) return { decision: "allow", action: write.action, currentRepository, target: write.target };
  if (!decision.target) {
    return { decision: "block", action: decision.action, currentRepository, reason: decision.reason };
  }

  const question = confirmationQuestion(write, decision.target, event.input);
  return {
    decision: "ask",
    action: decision.action,
    currentRepository,
    target: decision.target,
    fingerprint: authorizationKey(decision.action, decision.target, event.input, currentRepository ?? commandCwd),
    ask: {
      questions: [{
        id: confirmationQuestionId,
        question,
        options: [
          { label: "Approve", description: `Allow exactly this ${decision.action} to ${decision.target} once.`, preview: null },
          { label: "Reject", description: "Keep this write blocked.", preview: null },
        ],
        header: "External GitHub write",
        multi: false,
      }],
    },
  };
}
