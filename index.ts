import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

type ToolInput = Record<string, unknown>;
type GitPush = {
  target?: string;
  requiresExplicitTarget?: boolean;
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
export type ToolCallHandler = (event: ToolCallEvent, ctx: HookContext) => ToolCallResult;
type ToolResultHandler = (event: ToolResultEvent, ctx: HookContext) => void;
type AuthorizedGitPushParams = {
  remote: string;
  refspecs?: string[];
  cwd?: string;
};
type ZodSchema = {
  describe(description: string): ZodSchema;
  optional(): ZodSchema;
};
type Zod = {
  string(): ZodSchema;
  array(value: ZodSchema): ZodSchema;
  object(shape: Record<string, ZodSchema>): ZodSchema;
};
type AuthorizedGitPushTool = {
  name: "authorized_git_push";
  label: string;
  description: string;
  parameters: unknown;
  approval: "read";
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
  on(event: "tool_result", handler: ToolResultHandler): void;
  registerTool(tool: AuthorizedGitPushTool): void;
  zod: Zod;
  exec(
    command: string,
    args: string[],
    options: { cwd: string; signal?: AbortSignal },
  ): Promise<{ code: number; stdout: string; stderr: string; killed?: boolean }>;
  sendUserMessage(content: string, options: { deliverAs: "steer" }): void;
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

const AUTHORIZATION_QUESTION_ID = "authorize_git_push";
const APPROVE_PUSH = "Approve push";

function isAuthorizationAsk(input: ToolInput, target: string): boolean {
  const questions = input.questions;
  if (!Array.isArray(questions) || questions.length !== 1) return false;

  const question = questions[0];
  if (
    typeof question !== "object" ||
    question === null ||
    !("id" in question) ||
    !("question" in question)
  ) {
    return false;
  }

  return (
    question.id === AUTHORIZATION_QUESTION_ID &&
    question.question === `Allow git push to ${target}?`
  );
}

function isPushApproved(details: unknown): boolean {
  if (
    typeof details !== "object" ||
    details === null ||
    !("selectedOptions" in details) ||
    !Array.isArray(details.selectedOptions)
  ) {
    return false;
  }

  return details.selectedOptions.includes(APPROVE_PUSH);
}

export function createGitHubWriteGuard(): (pi: ExtensionAPI) => void {
  return function githubWriteGuard(pi: ExtensionAPI): void {
    let pendingAuthorization: { target: string } | undefined;
    let authorizedTarget: string | undefined;
    const z = pi.zod;
    pi.registerTool({
      name: "authorized_git_push",
      label: "Authorized Git Push",
      description: "Push once after the user approves the matching OMP ask prompt.",
      parameters: z.object({
        remote: z.string().describe("Git remote name or GitHub URL to push to"),
        refspecs: z.array(z.string()).optional(),
        cwd: z.string().optional(),
      }),
      approval: "read",
      formatApprovalDetails: ({ remote, refspecs, cwd }) => {
        const target = normalizeRepository(remote) ?? (cwd && gitRemoteRepository(cwd, remote, true));
        return [
          `Git push target: ${target ?? remote}`,
          ...(refspecs?.length ? [`Refspecs: ${refspecs.join(" ")}`] : []),
          ...(cwd ? [`Working directory: ${cwd}`] : []),
        ];
      },
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const cwd = params.cwd ?? ctx.cwd;
        const target = normalizeRepository(params.remote) ?? gitRemoteRepository(cwd, params.remote, true);
        if (!target) throw new Error(`GitHub push target cannot be resolved for ${params.remote}.`);

        const approvedTarget = authorizedTarget;
        authorizedTarget = undefined;
        if (approvedTarget !== target) {
          throw new Error(`Git push to ${target} requires an approved OMP ask prompt.`);
        }

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
    pi.on("tool_result", (event) => {
      const pending = pendingAuthorization;
      if (
        !pending ||
        event.toolName !== "ask" ||
        !isAuthorizationAsk(event.input, pending.target)
      ) {
        return;
      }

      pendingAuthorization = undefined;
      if (!event.isError && isPushApproved(event.details)) {
        authorizedTarget = pending.target;
      }
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

      const target = decision.target;
      const reason = `Blocked git push targeting ${target ?? "an unresolved target"}: ${decision.reason}.`;
      if (!target) return { block: true, reason };
      if (!ctx.hasUI) {
        return { block: true, reason: `${reason} Interactive authorization requires OMP UI.` };
      }
      if (pendingAuthorization || authorizedTarget) {
        return { block: true, reason: `${reason} An external push authorization is already pending.` };
      }

      pendingAuthorization = { target };
      pi.sendUserMessage(
        `Call the ask tool now with one question: id "${AUTHORIZATION_QUESTION_ID}", question ` +
          `"Allow git push to ${target}?", and options "${APPROVE_PUSH}" and "Reject push". ` +
          "Do not run another tool before the answer. If approved, call authorized_git_push for that target; otherwise stop.",
        { deliverAs: "steer" },
      );
      return { block: true, reason: `${reason} OMP ask authorization requested.` };
    });
  };
}

export default createGitHubWriteGuard();
