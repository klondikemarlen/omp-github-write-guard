import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { parse } from "shell-quote";

type ToolInput = Record<string, unknown>;
type GitHubWrite = {
  action: string;
  target?: string;
  targetUnresolved?: boolean;
  directories?: string[];
  remote?: string;
  description?: string;
};

export type ToolCallEvent = { toolName: string; input: ToolInput };

export type AskPayload = {
  questions: [
    {
      id: string;
      question: string;
      options: { label: string; description: string; preview: null }[];
      header: string;
      multi: false;
    },
  ];
};
export type GitHubWriteHandoff =
  | {
      decision: "allow";
      action?: GitHubWrite["action"];
      currentRepository?: string;
      target?: string;
    }
  | {
      decision: "ask";
      action: GitHubWrite["action"];
      currentRepository?: string;
      target: string;
      fingerprint: string;
      ask: AskPayload;
    }
  | {
      decision: "block";
      action: GitHubWrite["action"];
      currentRepository?: string;
      target?: string;
      reason: string;
    };
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

const GITHUB_CLI_WRITE_OPERATIONS: Record<string, { action: string; title?: string }> = {
  "issue create": { action: "GitHub issue creation", title: "Issue title" },
  "issue edit": { action: "GitHub issue update" },
  "issue close": { action: "GitHub issue update" },
  "issue reopen": { action: "GitHub issue update" },
  "issue delete": { action: "GitHub issue update" },
  "issue comment": { action: "GitHub issue update" },
  "issue lock": { action: "GitHub issue update" },
  "issue unlock": { action: "GitHub issue update" },
  "issue pin": { action: "GitHub issue update" },
  "issue unpin": { action: "GitHub issue update" },
  "pr create": { action: "GitHub pull request creation", title: "Pull request title" },
  "pr edit": { action: "GitHub pull request update" },
  "pr merge": { action: "GitHub pull request update" },
  "pr close": { action: "GitHub pull request update" },
  "pr reopen": { action: "GitHub pull request update" },
  "pr comment": { action: "GitHub pull request update" },
  "pr review": { action: "GitHub pull request update" },
  "pr ready": { action: "GitHub pull request update" },
  "pr lock": { action: "GitHub pull request update" },
  "pr unlock": { action: "GitHub pull request update" },
};
const GITHUB_DEVICE_READ_OPERATIONS = new Set([
  "pr_checkout",
  "repo_view",
  "run_watch",
  "search_code",
  "search_commits",
  "search_issues",
  "search_prs",
  "file_read",
  "search_repos",
]);
const GITHUB_DEVICE_WRITE_OPERATIONS: Record<string, { action: string; title?: string; requiresTarget?: boolean }> = {
  issue_create: { action: "GitHub issue creation", title: "Issue title" },
  issue_comment: { action: "GitHub issue update" },
  pr_create: { action: "GitHub pull request creation", title: "Pull request title" },
  pr_comment: { action: "GitHub pull request update" },
  pr_push: { action: "GitHub pull request update", requiresTarget: true },
};

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

function githubRepositoryFromRemoteUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const match = value
    .trim()
    .replace(/\.git$/, "")
    .match(/^(?:git@github\.com:|(?:git\+)?https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+)$/i);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}

function unquoteDirectory(directory: string): string | undefined {
  if (directory.startsWith("'") && directory.endsWith("'")) return directory.slice(1, -1);
  if (directory.startsWith('"') && directory.endsWith('"')) return directory.slice(1, -1);
  return /^[^\s;&|]+$/.test(directory) ? directory : undefined;
}

function commandDirectory(command: string, cwd: string): string | undefined {
  const directory = command.match(/^\s*cd(?:\s+--)?\s+((?:'[^']*'|"[^"]*"|[^\s;&|]+))\s*(?:&&|;|\n)/)?.[1];
  const parsed = directory && unquoteDirectory(directory);
  if (!parsed) return undefined;
  const expanded = parsed === "~" || parsed.startsWith("~/") ? `${homedir()}${parsed.slice(1)}` : parsed;
  return resolve(cwd, expanded);
}

function toolDirectory(input: ToolInput, sessionCwd: string): string | undefined {
  if (typeof input.cwd === "string" && input.cwd.trim()) {
    const directory = input.cwd.trim();
    const expanded = directory === "~" || directory.startsWith("~/") ? `${homedir()}${directory.slice(1)}` : directory;
    return isAbsolute(expanded) ? expanded : resolve(sessionCwd, expanded);
  }

  return typeof input.command === "string" ? commandDirectory(input.command, sessionCwd) : undefined;
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

function repositoryFromReference(value: unknown): string | undefined {
  const repository = normalizeRepository(value);
  if (repository || typeof value !== "string") return repository;

  const match = value.match(/github\.com[/:]([^/\s]+)\/([^/\s]+)/i);
  return match ? normalizeRepository(`${match[1]}/${match[2]}`) : undefined;
}

function targetFromWords(words: (string | undefined)[], index: number, title?: string) {
  let target: string | undefined;
  let targetUnresolved = false;
  let description: string | undefined;

  for (; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--repo" || word === "-R") {
      const repository = words[index + 1];
      if (typeof repository !== "string" || repository.startsWith("-")) {
        targetUnresolved = true;
      } else {
        target = normalizeRepository(repository);
        targetUnresolved ||= !target;
      }
      index += 1;
      continue;
    }
    if (typeof word === "string" && (word.startsWith("--repo=") || word.startsWith("-R="))) {
      target = normalizeRepository(word.slice(word.indexOf("=") + 1));
      targetUnresolved ||= !target;
      continue;
    }
    if (word === "--title" || word === "-t") {
      const value = words[index + 1];
      if (title && typeof value === "string" && !value.startsWith("-")) description = `${title}: ${value}`;
      index += 1;
      continue;
    }
    if (typeof word === "string" && (word.startsWith("--title=") || word.startsWith("-t="))) {
      if (title) description = `${title}: ${word.slice(word.indexOf("=") + 1)}`;
      continue;
    }
    target ||= repositoryFromReference(word);
  }
  return { target, targetUnresolved, description };
}

function repositoryFromApiPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const match = value.match(/(?:^|\/)repos\/([^/\s]+)\/([^/?\s]+)/i);
  return match ? normalizeRepository(`${match[1]}/${match[2]}`) : undefined;
}

function githubApiWriteFromWords(words: (string | undefined)[], index: number): GitHubWrite | undefined {
  const targetInfo = targetFromWords(words, index);
  let target = targetInfo.target;
  let targetUnresolved = targetInfo.targetUnresolved;
  let method = "GET";
  let methodUnresolved = false;
  let hasFields = false;

  for (; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--method" || word === "-X") {
      const value = words[index + 1];
      if (typeof value === "string") method = value.toUpperCase();
      else methodUnresolved = true;
      index += 1;
      continue;
    }
    if (typeof word === "string" && (word.startsWith("--method=") || word.startsWith("-X"))) {
      method = (word.startsWith("--method=") ? word.slice(word.indexOf("=") + 1) : word.slice(2)).toUpperCase();
      continue;
    }
    if (
      word === "--raw-field" ||
      word === "-f" ||
      word === "--field" ||
      word === "-F" ||
      word === "--input" ||
      (typeof word === "string" &&
        (word.startsWith("--raw-field=") || word.startsWith("--field=") || word.startsWith("-f") || word.startsWith("-F")))
    ) {
      hasFields = true;
    }
    target ||= repositoryFromApiPath(word);
  }

  if (!methodUnresolved && method === "GET" && !hasFields) return undefined;
  return {
    action: "GitHub API write",
    target,
    targetUnresolved: targetUnresolved || !target,
  };
}

function githubWriteFromWords(words: (string | undefined)[]): GitHubWrite | undefined {
  let index = 0;
  while (
    typeof words[index] === "string" &&
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])
  ) {
    index += 1;
  }
  if (words[index] !== "gh") return undefined;
  if (words[index + 1] === "api") return githubApiWriteFromWords(words, index + 2);

  const operation = GITHUB_CLI_WRITE_OPERATIONS[`${words[index + 1]} ${words[index + 2]}`];
  if (!operation) return undefined;

  return {
    action: operation.action,
    ...targetFromWords(words, index + 3, operation.title),
  };
}

function bashGitHubWrite(input: ToolInput): GitHubWrite | undefined {
  if (typeof input.command !== "string") return undefined;

  const commands = shellCommands(input.command);
  const writes = commands
    .map((words) => gitPushFromWords(words) ?? githubWriteFromWords(words))
    .filter((write): write is GitHubWrite => write !== undefined);
  if (writes.length === 1) return writes[0];
  if (writes.length > 1) return { action: "GitHub write", targetUnresolved: true };
  return undefined;
}

function githubDeviceWrite(input: ToolInput): GitHubWrite | undefined {
  if (input.path !== "xd://github" || typeof input.content !== "string") return undefined;
  try {
    const request = JSON.parse(input.content) as Record<string, unknown>;
    if (typeof request.op !== "string") return { action: "GitHub device request", targetUnresolved: true };
    if (GITHUB_DEVICE_READ_OPERATIONS.has(request.op)) return undefined;

    const operation = GITHUB_DEVICE_WRITE_OPERATIONS[request.op];
    if (!operation) return { action: "GitHub device request", targetUnresolved: true };

    const target = repositoryFromReference(request.repo) ?? repositoryFromReference(request.pr);
    const hasTarget = request.repo !== undefined || request.pr !== undefined;
    return {
      action: operation.action,
      target,
      targetUnresolved: (hasTarget && !target) || (operation.requiresTarget && !target),
      description:
        operation.title && typeof request.title === "string" ? `${operation.title}: ${request.title}` : undefined,
    };
  } catch {
    return { action: "GitHub device request", targetUnresolved: true };
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
  return githubRepositoryFromRemoteUrl(gitCommandOutput(cwd, ["remote", "get-url", "--push", remote]));
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
  const root = gitCommandOutput(cwd, ["rev-parse", "--show-toplevel"]);
  return root ? githubRepositoryFromRemoteUrl(gitCommandOutput(root, ["remote", "get-url", "origin"])) : undefined;
}

function writeFor(event: ToolCallEvent): GitHubWrite | undefined {
  if (event.toolName === "bash") return bashGitHubWrite(event.input);
  if (event.toolName === "write") return githubDeviceWrite(event.input);
  return undefined;
}

const CONFIRMATION_QUESTION_ID = "confirm_external_github_write";
const APPROVE_WRITE = "Approve";

function confirmationQuestion(write: GitHubWrite, target: string, input: ToolInput): string {
  const description =
    write.description ? `\n${write.description}` :
    typeof input.command === "string" ? `\nCommand: ${input.command}` :
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

function authorizationKey(action: GitHubWrite["action"], target: string, input: ToolInput, context: string): string {
  const entries = Object.entries(input).sort(([left], [right]) => left.localeCompare(right));
  return `${action}\u0000${target}\u0000${context}\u0000${JSON.stringify(entries)}`;
}

export function githubWriteHandoff(
  event: ToolCallEvent,
  cwd: string,
  activeDirectory = cwd,
): GitHubWriteHandoff {
  const write = writeFor(event);
  if (!write) return { decision: "allow" };

  const toolCwd = toolDirectory(event.input, activeDirectory) ?? activeDirectory;
  const commandCwd =
    write.directories?.reduce((directoryCwd, directory) => resolve(directoryCwd, directory), toolCwd) ??
    toolCwd;
  if (write.action === "git push" && !write.targetUnresolved) {
    const remote = write.remote ?? defaultPushRemote(commandCwd);
    write.target = githubRepositoryFromRemoteUrl(remote) ?? gitRemoteRepository(commandCwd, remote);
    write.targetUnresolved = !write.target;
  }
  if (write.action !== "git push" && !write.target && !write.targetUnresolved) {
    write.target = currentCheckoutRepository(commandCwd);
  }

  const currentRepository = currentCheckoutRepository(commandCwd);
  const decision = guardDecision(write, currentRepository);
  if (decision.allow) return { decision: "allow", action: write.action, currentRepository, target: write.target };

  const target = decision.target;
  if (!target) {
    return {
      decision: "block",
      action: decision.action,
      currentRepository,
      reason: decision.reason,
    };
  }

  const question = confirmationQuestion(write, target, event.input);
  return {
    decision: "ask",
    action: decision.action,
    currentRepository,
    target,
    fingerprint: authorizationKey(decision.action, target, event.input, currentRepository ?? commandCwd),
    ask: {
      questions: [
        {
          id: CONFIRMATION_QUESTION_ID,
          question,
          options: [
            {
              label: APPROVE_WRITE,
              description: `Allow exactly this ${decision.action} to ${target} once.`,
              preview: null,
            },
            { label: "Reject", description: "Keep this write blocked.", preview: null },
          ],
          header: "External GitHub write",
          multi: false,
        },
      ],
    },
  };
}

export function createGitHubWriteGuard(): (pi: ExtensionAPI) => void {
  return (pi) => {
    let pending: { key: string; question: string } | undefined;
    let authorizedKey: string | undefined;
    let activeDirectory: string | undefined;
    let sessionDirectory: string | undefined;

    pi.on("tool_result", (event) => {
      if (event.toolName !== "ask" || !pending) return;

      const request = pending;
      pending = undefined;
      if (!event.isError && isConfirmationAsk(event.input, request.question) && isApproved(event.details)) {
        authorizedKey = request.key;
      }
    });

    pi.on("tool_call", (event, ctx) => {
      if (sessionDirectory !== ctx.cwd) {
        sessionDirectory = ctx.cwd;
        activeDirectory = ctx.cwd;
        pending = undefined;
        authorizedKey = undefined;
      }
      const baseDirectory = activeDirectory ?? ctx.cwd;
      const nextDirectory = event.toolName === "bash" ? toolDirectory(event.input, baseDirectory) : undefined;
      const handoff = githubWriteHandoff(event, ctx.cwd, baseDirectory);
      if (handoff.decision === "allow") {
        if (nextDirectory) activeDirectory = nextDirectory;
        return;
      }

      if (handoff.decision === "block") {
        return {
          block: true,
          reason: `Blocked ${handoff.action} targeting ${handoff.target ?? "an unresolved target"}: ${handoff.reason}.`,
        };
      }
      const reason = `Blocked ${handoff.action} targeting ${handoff.target}: confirmation is required.`;
      if (!ctx.hasUI) {
        return { block: true, reason: `${reason} Interactive confirmation requires OMP UI.` };
      }

      if (authorizedKey) {
        if (authorizedKey === handoff.fingerprint) {
          authorizedKey = undefined;
          if (nextDirectory) activeDirectory = nextDirectory;
          return;
        }
        authorizedKey = undefined;
      }
      if (pending) {
        return { block: true, reason: `${reason} A confirmation is already pending.` };
      }

      const question = handoff.ask.questions[0].question;
      pending = { key: handoff.fingerprint, question };
      pi.sendUserMessage(
        `Call the ask tool now with this exact payload: ${JSON.stringify(handoff.ask)}. If approved, retry exactly the blocked ${handoff.action}; otherwise stop.`,
        { deliverAs: "steer" },
      );
      return { block: true, reason: `${reason} OMP ask confirmation requested.` };
    });
  };
}

export default createGitHubWriteGuard();
