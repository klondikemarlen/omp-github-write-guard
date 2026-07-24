import { resolve } from "node:path";

import type { ToolCallEvent } from "../extension/contract.ts";
import { currentCheckoutRepository, currentCheckoutRoot } from "../git/current-checkout.ts";
import { defaultPushRemote } from "../git/default-push-remote.ts";
import { pushRepository } from "../git/push-repository.ts";
import { gitPushWrite } from "../git/push-write.ts";
import { remoteRepository } from "../github/remote-repository.ts";
import { recognizedGitHubWrite } from "../github/recognized-write.ts";
import { reviewThreadRepository } from "../github/review-thread-repository.ts";
import type { GitHubWrite } from "../github/write.ts";
import { toolDirectory } from "../shell/directory.ts";
import { shellCommands } from "../shell/commands.ts";
import { askHandoff, type RepositoryMutationHandoff } from "./ask.ts";
import { guardDecision } from "./decision.ts";

function writeFor(event: ToolCallEvent): GitHubWrite | undefined {
  if (event.toolName === "write") return recognizedGitHubWrite(event.input);
  if (event.toolName !== "bash" || typeof event.input.command !== "string") return undefined;

  const writes = shellCommands(event.input.command)
    .map((words) => gitPushWrite(words) ?? recognizedGitHubWrite(event.input, words))
    .filter((write): write is GitHubWrite => write !== undefined);
  if (writes.length === 1) return writes[0];
  return writes.length > 1 ? { action: "GitHub write", targetUnresolved: true } : undefined;
}

export function githubHandoff(event: ToolCallEvent, cwd: string): RepositoryMutationHandoff {
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
