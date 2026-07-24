import { resolve } from "node:path";

import type { ToolCallEvent } from "../extension/contract.ts";
import { currentCheckoutRepository, currentCheckoutRoot } from "../git/current-checkout.ts";
import { defaultPushRemote } from "../git/default-push-remote.ts";
import { pushRepository } from "../git/push-repository.ts";
import { remoteRepository } from "../github/remote-repository.ts";
import { gitPushWrite } from "../git/push-write.ts";
import { recognizedGitHubWrite } from "../github/recognized-write.ts";
import { reviewThreadRepository } from "../github/review-thread-repository.ts";
import type { GitHubWrite } from "../github/write.ts";
import { toolDirectory } from "../shell/directory.ts";
import { hasBoundaryOverride, shellCommands } from "../shell/commands.ts";
import { authorizationKey } from "./authorization-key.ts";
import { confirmationQuestion, confirmationQuestionId } from "./confirmation-question.ts";
import { guardDecision } from "./decision.ts";
import { localMutation } from "./local-mutation.ts";
import { boundaryPolicy, type BoundaryCategory, type BoundaryPolicy } from "./policy.ts";

export type AskPayload = {
  questions: [{
    id: string;
    question: string;
    options: { label: string; description: string; preview: null }[];
    header: string;
    multi: false;
  }];
};

export type RepositoryMutationHandoff =
  | { decision: "allow"; action?: string; currentRepository?: string; target?: string }
  | { decision: "ask"; action: string; category: BoundaryCategory; currentRepository?: string; target: string; fingerprint: string; ask: AskPayload };

function hasExplicitBoundaryOverride(event: ToolCallEvent): boolean {
  if ((event.toolName === "write" || event.toolName === "edit") && event.input.boundaryOverride === "allow-external-mutation") return true;
  return event.toolName === "bash" && typeof event.input.command === "string" && hasBoundaryOverride(event.input.command);
}

function writeFor(event: ToolCallEvent): GitHubWrite | undefined {
  if (event.toolName === "write") return recognizedGitHubWrite(event.input);
  if (event.toolName !== "bash" || typeof event.input.command !== "string") return undefined;

  const writes = shellCommands(event.input.command)
    .map((words) => gitPushWrite(words) ?? recognizedGitHubWrite(event.input, words))
    .filter((write): write is GitHubWrite => write !== undefined);
  if (writes.length === 1) return writes[0];
  return writes.length > 1 ? { action: "GitHub write", targetUnresolved: true } : undefined;
}

function askHandoff(
  action: string,
  target: string,
  event: ToolCallEvent,
  context: string,
  category: BoundaryCategory,
  currentRepository?: string,
  description?: string,
): RepositoryMutationHandoff {
  const question = confirmationQuestion(action, target, event.input, description, currentRepository, category);
  return {
    decision: "ask",
    action,
    category,
    currentRepository,
    target,
    fingerprint: authorizationKey(action, target, event.input, context),
    ask: {
      questions: [{
        id: confirmationQuestionId,
        question,
        options: [
          { label: "Approve", description: `Allow exactly this ${action} to ${target} once.`, preview: null },
          { label: "Reject", description: "Keep this write blocked.", preview: null },
        ],
        header: "Repository boundary",
        multi: false,
      }],
    },
  };
}


function githubHandoff(event: ToolCallEvent, cwd: string): RepositoryMutationHandoff {
  const write = writeFor(event);
  if (!write) return { decision: "allow" };

  const inputDirectory = toolDirectory(event.input, cwd);
  const toolCwd = typeof inputDirectory === "string" ? inputDirectory : cwd;
  if (inputDirectory && typeof inputDirectory !== "string") write.targetUnresolved = true;
  const commandCwd = write.directories?.reduce((directoryCwd, directory) => resolve(directoryCwd, directory), toolCwd) ?? toolCwd;
  if (write.action === "git push" && !write.targetUnresolved) {
    const remote = write.remote ?? defaultPushRemote(commandCwd);
    write.target = remoteRepository(remote) ?? pushRepository(commandCwd, remote);
    write.targetUnresolved = !write.target;
  }
  if (write.reviewThreadUnresolved) write.targetUnresolved = true;
  if (write.reviewThreadId && !write.targetUnresolved) {
    const threadRepository = reviewThreadRepository(write.reviewThreadId);
    if (!threadRepository || write.target && write.target !== threadRepository) {
      write.targetUnresolved = true;
    } else {
      write.target = threadRepository;
    }
  }
  if (write.action !== "git push" && !write.target && !write.targetUnresolved) {
    write.target = currentCheckoutRepository(commandCwd);
  }

  const currentRepository = currentCheckoutRepository(cwd);
  const decision = guardDecision(write, currentRepository);
  if (decision.allow) return { decision: "allow", action: write.action, currentRepository, target: write.target };

  return askHandoff(
    decision.action,
    decision.target,
    event,
    currentRepository ?? currentCheckoutRoot(cwd) ?? cwd,
    write.action === "git push" ? "git" : "github",
    currentRepository,
    write.description,
  );
}

function localHandoff(event: ToolCallEvent, cwd: string): RepositoryMutationHandoff | undefined {
  const mutation = localMutation(event, cwd);
  if (!mutation) return undefined;

  return askHandoff(mutation.action, mutation.targets.join(", "), event, mutation.boundary, "local");
}

function applyScopePolicy(
  handoff: RepositoryMutationHandoff,
  policy: BoundaryPolicy,
  allowExternalMutation: boolean,
): RepositoryMutationHandoff {
  if (handoff.decision !== "ask") return handoff;
  if (policy.error || (!allowExternalMutation && !policy.exemptions.has(handoff.category))) return handoff;
  return { decision: "allow", action: handoff.action, currentRepository: handoff.currentRepository, target: handoff.target };
}


export function repositoryMutationHandoff(event: ToolCallEvent, cwd: string): RepositoryMutationHandoff {
  const allowExternalMutation = hasExplicitBoundaryOverride(event);
  const policy = boundaryPolicy();
  const github = applyScopePolicy(githubHandoff(event, cwd), policy, allowExternalMutation);
  if (github.decision !== "allow") return github;
  const local = applyScopePolicy(localHandoff(event, cwd) ?? github, policy, allowExternalMutation);
  return local;
}
