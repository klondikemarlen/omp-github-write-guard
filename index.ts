import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { parse } from "shell-quote";

type ToolInput = Record<string, unknown>;
type GitHubWrite = {
  action: "git push" | "GitHub issue creation";
  target?: string;
  targetUnresolved?: boolean;
  directories?: string[];
  remote?: string;
  description?: string;
};

export type ToolCallEvent = { toolName: string; input: ToolInput };
type ToolResultEvent = {
  toolName: string;
  input: ToolInput;
  details: unknown;
  isError: boolean;
};
export type ToolCallResult = { block: true; reason: string } | undefined;
export type HookContext = { cwd: string; hasUI?: boolean };
export type ToolCallHandler = (
  event: ToolCallEvent,
  ctx: HookContext,
) => ToolCallResult | Promise<ToolCallResult>;
type ToolResultHandler = (event: ToolResultEvent, ctx: HookContext) => void;
type ExtensionAPI = {
  on(event: "tool_call", handler: ToolCallHandler): void;
  on(event: "tool_result", handler: ToolResultHandler): void;
  sendUserMessage(content: string, options: { deliverAs: "steer" }): void;
};

const SHELL_COMMAND_BOUNDARIES = new Set(["&&", "||", ";", "|", "|&", "&"]);
const SHELL_REDIRECTIONS = new Set(["<", ">", ">>", "<&", ">&", "<<<"]);
const GIT_PUSH_FLAGS = new Set([
  "-d",
  "-f",
  "-q",
  "-u",
  "-v",
  "--all",
  "--atomic",
  "--delete",
  "--dry-run",
  "--follow-tags",
  "--force",
  "--force-if-includes",
  "--force-with-lease",
  "--mirror",
  "--no-thin",
  "--no-verify",
  "--porcelain",
  "--prune",
  "--quiet",
  "--set-upstream",
  "--tags",
  "--thin",
  "--verbose",
]);

const GIT_GLOBAL_FLAGS = new Set(["-P", "--no-pager", "--paginate"]);
const GIT_GLOBAL_OPTIONS_WITH_ARGUMENT = new Set(["-c", "--config"]);

function normalizeRepository(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim().replace(/\.git$/, "");
  const match =
    trimmed.match(/github\.com[/:]([^/\s]+)\/([^/\s]+)$/i) ??
    trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  const owner = match?.[1];
  const repository = match?.[2];

  return owner && repository ? `${owner}/${repository}`.toLowerCase() : undefined;
}

function shellCommands(command: string): (string | undefined)[][] {
  try {
    const tokens = parse(command, () => ({}));
    const commands: (string | undefined)[][] = [];
    let words: (string | undefined)[] = [];
    let discardNext = false;

    for (const token of tokens) {
      if (typeof token === "string") {
        if (discardNext) discardNext = false;
        else words.push(token);
        continue;
      }
      if ("comment" in token) break;
      if (!("op" in token) || token.op === "glob") {
        if (discardNext) discardNext = false;
        else words.push(undefined);
        continue;
      }
      if (SHELL_COMMAND_BOUNDARIES.has(token.op)) {
        if (words.length) commands.push(words);
        words = [];
        discardNext = false;
      } else if (SHELL_REDIRECTIONS.has(token.op)) {
        discardNext = true;
      }
    }
    if (words.length) commands.push(words);
    return commands;
  } catch {
    return [];
  }
}

function gitPushFromWords(words: (string | undefined)[]): GitHubWrite | undefined {
  let index = 0;
  while (
    typeof words[index] === "string" &&
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])
  ) {
    index += 1;
  }
  if (words[index] !== "git") return undefined;

  index += 1;
  const directories: string[] = [];
  while (words[index] !== "push") {
    const word = words[index];
    if (typeof word !== "string") return undefined;
    if (word === "-C") {
      const directory = words[index + 1];
      if (typeof directory !== "string") return undefined;
      directories.push(directory);
      index += 2;
      continue;
    }
    if (word.startsWith("-C") && word.length > 2) {
      directories.push(word.slice(2));
      index += 1;
      continue;
    }
    if (GIT_GLOBAL_OPTIONS_WITH_ARGUMENT.has(word)) {
      if (typeof words[index + 1] !== "string") return undefined;
      index += 2;
      continue;
    }
    if (GIT_GLOBAL_FLAGS.has(word)) {
      index += 1;
      continue;
    }
    return word.startsWith("-") ? { action: "git push", directories, targetUnresolved: true } : undefined;
  }

  let remote: string | undefined;
  for (index += 1; index < words.length; index += 1) {
    const word = words[index];
    if (typeof word !== "string" || (word.startsWith("-") && !GIT_PUSH_FLAGS.has(word))) {
      return { action: "git push", directories, targetUnresolved: true };
    }
    if (!word.startsWith("-")) {
      remote = word;
      break;
    }
  }
  return { action: "git push", directories, remote };
}

function issueCreateFromWords(words: (string | undefined)[]): GitHubWrite | undefined {
  let index = 0;
  while (
    typeof words[index] === "string" &&
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])
  ) {
    index += 1;
  }
  if (words[index] !== "gh" || words[index + 1] !== "issue" || words[index + 2] !== "create") {
    return undefined;
  }

  let target: string | undefined;
  let description: string | undefined;
  for (index += 3; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--repo" || word === "-R") {
      const repository = words[index + 1];
      if (typeof repository !== "string" || repository.startsWith("-")) {
        return { action: "GitHub issue creation", targetUnresolved: true };
      }
      target = normalizeRepository(repository);
      if (!target) return { action: "GitHub issue creation", targetUnresolved: true };
      index += 1;
      continue;
    }
    if (typeof word === "string" && (word.startsWith("--repo=") || word.startsWith("-R="))) {
      target = normalizeRepository(word.slice(word.indexOf("=") + 1));
      if (!target) return { action: "GitHub issue creation", targetUnresolved: true };
      continue;
    }
    if (word === "--title" || word === "-t") {
      const title = words[index + 1];
      if (typeof title === "string" && !title.startsWith("-")) {
        description = title;
        index += 1;
      }
      continue;
    }
    if (typeof word === "string" && (word.startsWith("--title=") || word.startsWith("-t="))) {
      description = word.slice(word.indexOf("=") + 1);
    }
  }
  return { action: "GitHub issue creation", target, description };
}

function bashGitHubWrite(input: ToolInput): GitHubWrite | undefined {
  if (typeof input.command !== "string") return undefined;

  const commands = shellCommands(input.command);
  const writes = commands
    .map((words) => gitPushFromWords(words) ?? issueCreateFromWords(words))
    .filter((write): write is GitHubWrite => write !== undefined);
  if (writes.length === 1) return writes[0];
  if (writes.length > 1) return { action: "git push", targetUnresolved: true };
  return undefined;
}

function githubDeviceIssueCreate(input: ToolInput): GitHubWrite | undefined {
  if (input.path !== "xd://github" || typeof input.content !== "string") return undefined;
  try {
    const request = JSON.parse(input.content) as { op?: unknown; repo?: unknown; title?: unknown };
    if (request.op !== "issue_create") return undefined;
    const target = normalizeRepository(request.repo);
    return {
      action: "GitHub issue creation",
      target,
      targetUnresolved: !target,
      description: typeof request.title === "string" ? request.title : undefined,
    };
  } catch {
    return undefined;
  }
}

export type GuardDecision =
  | { allow: true }
  | { allow: false; action: GitHubWrite["action"]; target?: string; reason: string };

export function guardDecision(
  write: GitHubWrite | undefined,
  currentRepository?: string,
  defaultRepository = currentRepository,
): GuardDecision {
  if (!write) return { allow: true };

  const target = write.targetUnresolved ? undefined : write.target ?? defaultRepository;
  const blocked = (reason: string): GuardDecision => ({
    allow: false,
    action: write.action,
    target,
    reason,
  });

  if (!currentRepository) return blocked("the current checkout has no resolvable GitHub origin repository");
  if (!target) return blocked("the GitHub target cannot be resolved");
  if (target === currentRepository) return { allow: true };
  return blocked(`the target differs from the current checkout (${currentRepository})`);
}

function gitCommandOutput(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function gitRemoteRepository(cwd: string, remote: string): string | undefined {
  return normalizeRepository(gitCommandOutput(cwd, ["remote", "get-url", "--push", remote]));
}

function defaultPushRemote(cwd: string): string {
  const branch = gitCommandOutput(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return (
    (branch && gitCommandOutput(cwd, ["config", "--get", `branch.${branch}.pushRemote`])) ??
    gitCommandOutput(cwd, ["config", "--get", "remote.pushDefault"]) ??
    (branch && gitCommandOutput(cwd, ["config", "--get", `branch.${branch}.remote`])) ??
    "origin"
  );
}

export function currentCheckoutRepository(cwd: string): string | undefined {
  return normalizeRepository(gitCommandOutput(cwd, ["remote", "get-url", "origin"]));
}

function writeFor(event: ToolCallEvent): GitHubWrite | undefined {
  if (event.toolName === "bash") return bashGitHubWrite(event.input);
  if (event.toolName === "write") return githubDeviceIssueCreate(event.input);
  return undefined;
}

const CONFIRMATION_QUESTION_ID = "confirm_external_github_write";
const APPROVE_WRITE = "Approve";

function confirmationQuestion(write: GitHubWrite, target: string, input: ToolInput): string {
  const description =
    write.description ? `\nIssue title: ${write.description}` :
    write.action === "git push" && typeof input.command === "string" ? `\nCommand: ${input.command}` :
    "";
  return `Allow one ${write.action} to ${target}?${description}`;
}

function isConfirmationAsk(input: ToolInput, expectedQuestion: string): boolean {
  const questions = input.questions;
  if (!Array.isArray(questions) || questions.length !== 1) return false;

  const question = questions[0];
  return (
    typeof question === "object" &&
    question !== null &&
    "id" in question &&
    "question" in question &&
    question.id === CONFIRMATION_QUESTION_ID &&
    question.question === expectedQuestion
  );
}

function isApproved(details: unknown): boolean {
  return (
    typeof details === "object" &&
    details !== null &&
    "selectedOptions" in details &&
    Array.isArray(details.selectedOptions) &&
    details.selectedOptions.includes(APPROVE_WRITE)
  );
}

function authorizationKey(action: GitHubWrite["action"], target: string, input: ToolInput): string {
  const entries = Object.entries(input).sort(([left], [right]) => left.localeCompare(right));
  return `${action}\u0000${target}\u0000${JSON.stringify(entries)}`;
}

export function createGitHubWriteGuard(): (pi: ExtensionAPI) => void {
  return (pi) => {
    let pending: { key: string; question: string } | undefined;
    let authorizedKey: string | undefined;

    pi.on("tool_result", (event) => {
      if (event.toolName !== "ask" || !pending) return;

      const request = pending;
      pending = undefined;
      if (!event.isError && isConfirmationAsk(event.input, request.question) && isApproved(event.details)) {
        authorizedKey = request.key;
      }
    });

    pi.on("tool_call", (event, ctx) => {
      const write = writeFor(event);
      if (!write) return;

      const toolCwd = typeof event.input.cwd === "string" ? event.input.cwd : ctx.cwd;
      const commandCwd =
        write.directories?.reduce((cwd, directory) => resolve(cwd, directory), toolCwd) ?? toolCwd;
      if (write.action === "git push" && !write.targetUnresolved) {
        const remote = write.remote ?? defaultPushRemote(commandCwd);
        write.target = normalizeRepository(remote) ?? gitRemoteRepository(commandCwd, remote);
        write.targetUnresolved = !write.target;
      }
      if (write.action === "GitHub issue creation" && !write.target) {
        write.target = currentCheckoutRepository(toolCwd);
      }

      const decision = guardDecision(write, currentCheckoutRepository(ctx.cwd));
      if (decision.allow) return;

      const target = decision.target;
      const reason = `Blocked ${decision.action} targeting ${target ?? "an unresolved target"}: ${decision.reason}.`;
      if (!target || !ctx.hasUI) {
        return {
          block: true,
          reason: `${reason}${target ? " Interactive confirmation requires OMP UI." : ""}`,
        };
      }

      const key = authorizationKey(decision.action, target, event.input);
      if (authorizedKey) {
        if (authorizedKey === key) {
          authorizedKey = undefined;
          return;
        }
        authorizedKey = undefined;
      }
      if (pending) {
        return { block: true, reason: `${reason} A confirmation is already pending.` };
      }

      const question = confirmationQuestion(write, target, event.input);
      pending = { key, question };
      pi.sendUserMessage(
        `Call the ask tool now with this exact question: ${JSON.stringify({
          id: CONFIRMATION_QUESTION_ID,
          question,
          options: [APPROVE_WRITE, "Reject"],
        })}. If approved, retry exactly the blocked ${decision.action}; otherwise stop.`,
        { deliverAs: "steer" },
      );
      return { block: true, reason: `${reason} OMP ask confirmation requested.` };
    });
  };
}

export default createGitHubWriteGuard();
