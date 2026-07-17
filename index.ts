import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

type ToolInput = Record<string, unknown>;
type GitPush = {
  target?: string;
  requiresExplicitTarget?: boolean;
};
export type ToolCallEvent = { toolName: string; input: ToolInput };
export type ToolCallResult = { block: true; reason: string } | undefined;
export type HookContext = { cwd: string };
export type ToolCallHandler = (event: ToolCallEvent, ctx: HookContext) => ToolCallResult;
type AuthorizedGitPushParams = {
  remote: string;
  refspecs?: string[];
  cwd?: string;
};
type AuthorizedGitPushTool = {
  name: "authorized_git_push";
  label: string;
  description: string;
  parameters: unknown;
  approval: { tier: "exec"; override: true; reason: string };
  formatApprovalDetails(params: AuthorizedGitPushParams): string[];
  execute(
    toolCallId: string,
    params: AuthorizedGitPushParams,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: HookContext,
  ): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }>;
};
type ExtensionAPI = {
  on(event: "tool_call", handler: ToolCallHandler): void;
  registerTool(tool: AuthorizedGitPushTool): void;
  zod: unknown;
  exec(
    command: string,
    args: string[],
    options: { cwd: string; signal?: AbortSignal },
  ): Promise<{ code: number; stdout: string; stderr: string; killed?: boolean }>;
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

const GIT_PUSH_COMMAND =
  /(?:^|&&|\|\||;|\||\n)\s*git(?<directories>(?:\s+-C\s+\S+)*)\s+push\b/;

function gitPushCwd(command: string, cwd: string): string {
  const directories = command.match(GIT_PUSH_COMMAND)?.groups?.directories;
  if (!directories) return cwd;

  return [...directories.matchAll(/\s+-C\s+(\S+)/g)].reduce(
    (currentCwd, [, directory]) => resolve(currentCwd, directory),
    cwd,
  );
}

function gitPushRemote(command: string): string | undefined {
  return command.match(
    /(?:^|&&|\|\||;|\||\n)\s*git(?:\s+-C\s+\S+)*\s+push(?:\s+(?:-u|--set-upstream|--force-with-lease(?:=\S+)?|--force|--tags|--all|--mirror|--dry-run|--atomic))*\s+([^\s-][^\s]*)/,
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
    const z = pi.zod as {
      string(): { describe(description: string): unknown; optional(): unknown };
      array(value: unknown): { optional(): unknown };
      object(shape: Record<string, unknown>): unknown;
    };
    pi.registerTool({
      name: "authorized_git_push",
      label: "Authorize Git Push",
      description:
        "Push to a GitHub remote after standard OMP approval. Use when an external git push is blocked.",
      parameters: z.object({
        remote: z.string().describe("Git remote name or GitHub URL to push to"),
        refspecs: z.array(z.string()).optional(),
        cwd: z.string().optional(),
      }),
      approval: {
        tier: "exec",
        override: true,
        reason: "Git push can write to a repository outside the current checkout.",
      },
      formatApprovalDetails: ({ remote, refspecs, cwd }) => [
        `Git push remote: ${remote}`,
        ...(refspecs?.length ? [`Refspecs: ${refspecs.join(" ")}`] : []),
        ...(cwd ? [`Working directory: ${cwd}`] : []),
      ],
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const cwd = params.cwd ?? ctx.cwd;
        const target = normalizeRepository(params.remote) ?? gitRemoteRepository(cwd, params.remote, true);
        if (!target) throw new Error(`GitHub push target cannot be resolved for ${params.remote}.`);

        const result = await pi.exec("git", ["push", params.remote, ...(params.refspecs ?? [])], {
          cwd,
          signal,
        });
        if (result.killed) throw new Error("Git push was cancelled.");
        if (result.code !== 0) throw new Error(result.stderr || "Git push failed.");

        return {
          content: [{ type: "text", text: `Pushed to ${target}.` }],
          details: { target, remote: params.remote, refspecs: params.refspecs ?? [] },
        };
      },
    });
    pi.on("tool_call", (event, ctx) => {
      if (event.toolName !== "bash" || !gitPushWrite(event.input)) return;

      const toolCwd = typeof event.input.cwd === "string" ? event.input.cwd : ctx.cwd;
      const commandCwd =
        typeof event.input.command === "string"
          ? gitPushCwd(event.input.command, toolCwd)
          : toolCwd;
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
        reason:
          `Blocked git push targeting ${target}: ${decision.reason}. ` +
          "Use authorized_git_push with an explicit remote and refspecs to request standard OMP approval.",
      };
    });
  };
}

export default createGitHubWriteGuard();
