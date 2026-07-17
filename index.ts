import { execFileSync } from "node:child_process";

type ToolInput = Record<string, unknown>;
type GitPush = {
  target?: string;
  requiresExplicitTarget?: boolean;
};

export type ToolCallEvent = { toolName: string; input: ToolInput };
export type ToolCallResult = { block: true; reason: string } | undefined;
export type HookContext = { cwd: string };
export type ToolCallHandler = (event: ToolCallEvent, ctx: HookContext) => ToolCallResult;
type ExtensionAPI = {
  on(event: "tool_call", handler: ToolCallHandler): void;
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

const GIT_PUSH_COMMAND = /(?:^|&&|\|\||;|\||\n)\s*git\s+push\b/;

function gitPushRemote(command: string): string | undefined {
  return command.match(
    /(?:^|&&|\|\||;|\||\n)\s*git\s+push(?:\s+(?:-u|--set-upstream|--force-with-lease(?:=\S+)?|--force|--tags|--all|--mirror|--dry-run|--atomic))*\s+([^\s-][^\s]*)/,
  )?.[1];
}

function gitPushWrite(input: ToolInput): GitPush | undefined {
  if (typeof input.command !== "string" || !GIT_PUSH_COMMAND.test(input.command)) return undefined;

  const remote = gitPushRemote(input.command);
  const target = normalizeRepository(remote);
  return {
    target,
    requiresExplicitTarget: !remote || (remote !== "origin" && !target),
  };
}

export type GuardDecision =
  | { allow: true }
  | {
      allow: false;
      action: "git push";
      target?: string;
      reason: string;
    };

export function guardDecision(
  input: ToolInput,
  currentRepository?: string,
  defaultRepository = currentRepository,
  resolvedPushTarget?: string,
): GuardDecision {
  const push = gitPushWrite(input);
  if (!push) return { allow: true };

  const target = push.requiresExplicitTarget
    ? push.target ?? resolvedPushTarget
    : push.target ?? defaultRepository;
  const blocked = (reason: string): GuardDecision => ({
    allow: false,
    action: "git push",
    target,
    reason,
  });

  if (!currentRepository) {
    return blocked("the current checkout has no resolvable GitHub origin repository");
  }
  if (!target) return blocked("the GitHub target cannot be resolved");
  if (target === currentRepository) return { allow: true };

  return blocked(`the target differs from the current checkout (${currentRepository})`);
}

function gitRemoteRepository(cwd: string, remote: string, push = false): string | undefined {
  try {
    return normalizeRepository(
      execFileSync("git", ["-C", cwd, "remote", "get-url", ...(push ? ["--push"] : []), remote], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return undefined;
  }
}

export function currentCheckoutRepository(cwd: string): string | undefined {
  return gitRemoteRepository(cwd, "origin");
}

export function createGitHubWriteGuard(): (pi: ExtensionAPI) => void {
  return function githubWriteGuard(pi: ExtensionAPI): void {
    pi.on("tool_call", (event, ctx) => {
      if (event.toolName !== "bash" || !gitPushWrite(event.input)) return;

      const commandCwd = typeof event.input.cwd === "string" ? event.input.cwd : ctx.cwd;
      const pushRemote = typeof event.input.command === "string" ? gitPushRemote(event.input.command) : undefined;
      const currentRepository = currentCheckoutRepository(ctx.cwd);
      const resolvedPushTarget =
        pushRemote && !normalizeRepository(pushRemote)
          ? gitRemoteRepository(commandCwd, pushRemote, true)
          : undefined;
      const defaultRepository =
        resolvedPushTarget ??
        (commandCwd === ctx.cwd ? currentRepository : currentCheckoutRepository(commandCwd));
      const decision = guardDecision(
        event.input,
        currentRepository,
        defaultRepository,
        resolvedPushTarget,
      );
      if (decision.allow) return;

      const target = decision.target ?? "an unresolved target";
      return {
        block: true,
        reason: `Blocked git push targeting ${target}: ${decision.reason}.`,
      };
    });
  };
}

export default createGitHubWriteGuard();
