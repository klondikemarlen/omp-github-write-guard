import { execFileSync } from "node:child_process";

type ToolInput = Record<string, unknown>;
type GitHubWrite = {
  action: string;
  target?: string;
  requiresExplicitTarget?: boolean;
};

export type ToolCallEvent = { toolName: string; input: ToolInput };
export type ToolCallResult = { block: true; reason: string } | undefined;
export type HookContext = {
  cwd: string;
  hasUI: boolean;
  ui: { confirm(title: string, message: string): boolean | Promise<boolean> };
};
export type ToolCallHandler = (
  event: ToolCallEvent,
  ctx: HookContext,
) => ToolCallResult | Promise<ToolCallResult>;
type ExtensionAPI = {
  on(event: "tool_call", handler: ToolCallHandler): void;
  logger?: { warn(message: string): void };
};


const GITHUB_WRITE_OPERATIONS: Record<string, true> = {
  pr_create: true,
  pr_push: true,
  issue_create: true,
  issue_comment: true,
  pr_comment: true,
  repo_fork: true,
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

function repositoryTarget(command: string): string | undefined {
  const match =
    command.match(/(?:--repo|-R)(?:=|\s+)([^\s]+)/)?.[1] ??
    command.match(/\brepos\/([^/\s]+)\/([^/\s?#]+)/i)?.slice(1).join("/") ??
    command.match(/github\.com[/:]([^/\s]+)\/([^/\s?#]+)/i)?.slice(1).join("/");

  return normalizeRepository(match?.replace(/^["']|["']$/g, ""));
}

function hasRepositoryOption(command: string): boolean {
  return /(?:--repo|-R)(?:=|\s+)/.test(command);
}

function githubDeviceWrite(input: ToolInput): GitHubWrite | undefined {
  if (input.path !== "xd://github" || typeof input.content !== "string") return undefined;

  try {
    const parsed: unknown = JSON.parse(input.content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { action: "GitHub write with unreadable arguments", requiresExplicitTarget: true };
    }

    const payload = parsed as ToolInput;
    const op = typeof payload.op === "string" ? payload.op : undefined;
    if (!op || !GITHUB_WRITE_OPERATIONS[op]) return undefined;

    const target = normalizeRepository(payload.repo);
    const requiresExplicitTarget = Object.hasOwn(payload, "repo") && !target;
    return {
      action:
        op === "issue_create"
          ? "Create GitHub issue"
          : op === "pr_create"
            ? "Create pull request"
            : "GitHub write",
      target: op === "repo_fork" ? undefined : target,
      requiresExplicitTarget: op === "repo_fork" || requiresExplicitTarget,
    };
  } catch {
    return { action: "GitHub write with unreadable arguments", requiresExplicitTarget: true };
  }
}

function bashGitHubWrite(input: ToolInput): GitHubWrite | undefined {
  if (typeof input.command !== "string") return undefined;
  const command = input.command;
  const target = repositoryTarget(command);
  const apiWrite =
    /\bgh\s+api\b/.test(command) &&
    (/(?:\s-X|\s--method)(?:\s+|=)(?:POST|PUT|PATCH|DELETE)\b/i.test(command) ||
      /\s(?:-f|--field|--raw-field|--input)(?:\s+|=)/.test(command));
  if (/\bgh\s+issue\s+create\b/.test(command)) {
    return {
      action: "Create GitHub issue",
      target,
      requiresExplicitTarget: hasRepositoryOption(command) && !target,
    };
  }
  if (/\bgh\s+pr\s+create\b/.test(command)) {
    return {
      action: "Create pull request",
      target,
      requiresExplicitTarget: hasRepositoryOption(command) && !target,
    };
  }
  if (apiWrite && /\brepos\/[^/\s]+\/[^/\s?#]+\/issues(?:[?\s]|$)/i.test(command)) {
    return { action: "Create GitHub issue", target };
  }
  if (apiWrite && /\brepos\/[^/\s]+\/[^/\s?#]+\/pulls(?:[?\s]|$)/i.test(command)) {
    return { action: "Create pull request", target };
  }
  if (/\bgh\s+repo\s+(?:fork|create|edit|delete|rename|archive|unarchive)\b/.test(command)) {
    return {
      action: "GitHub write",
      target,
      requiresExplicitTarget:
        /\bgh\s+repo\s+fork\b/.test(command) ||
        ((hasRepositoryOption(command) || /\bgh\s+repo\s+\w+\s+[^\s-]/.test(command)) && !target),
    };
  }
  if (
    /\bgh\s+(?:pr\s+(?:comment|checkout|edit|merge|close|reopen)|issue\s+(?:comment|edit|close|reopen|transfer|lock|unlock)|release\s+(?:create|edit|delete)|label\s+(?:create|edit|delete)|workflow\s+(?:run|enable|disable)|variable\s+(?:set|delete)|secret\s+(?:set|delete)|ruleset\s+(?:create|edit|delete)|deploy-key\s+(?:add|delete)|autolink\s+(?:create|delete)|run\s+(?:rerun|cancel)|cache\s+delete)\b/.test(
      command,
    ) ||
    apiWrite
  ) {
    return {
      action: "GitHub write",
      target,
      requiresExplicitTarget: hasRepositoryOption(command) && !target,
    };
  }
  if (/\bgit\s+push\b/.test(command)) {
    const remote = command.match(
      /\bgit\s+push(?:\s+(?:-u|--set-upstream|--force-with-lease(?:=\S+)?|--force|--tags|--all|--mirror|--dry-run))*\s+([^\s-][^\s]*)/,
    )?.[1];
    const remoteTarget = normalizeRepository(remote);
    return {
      action: "git push",
      target: remoteTarget,
      requiresExplicitTarget: !remote || (remote !== "origin" && !remoteTarget),
    };
  }

  return undefined;
}


export type GuardDecision =
  | { allow: true }
  | {
      allow: false;
      action: string;
      target?: string;
      reason: string;
      requiresConfirmation?: true;
    };

export function guardDecision(
  input: ToolInput,
  currentRepository?: string,
  defaultRepository = currentRepository,
): GuardDecision {
  const write = githubDeviceWrite(input) ?? bashGitHubWrite(input);
  if (!write) return { allow: true };

  const target = write.requiresExplicitTarget ? write.target : write.target ?? defaultRepository;
  const blocked = (reason: string): GuardDecision => ({
    allow: false,
    action: write.action,
    target,
    reason,
  });

  if (!currentRepository) {
    return blocked("the current checkout has no resolvable GitHub origin repository");
  }
  if (write.requiresExplicitTarget || !target) {
    return blocked("the GitHub target cannot be resolved");
  }
  if (target === currentRepository) return { allow: true };

  return { ...blocked(`the target differs from the current checkout (${currentRepository})`), requiresConfirmation: true };
}


export function currentCheckoutRepository(cwd: string): string | undefined {
  try {
    return normalizeRepository(
      execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return undefined;
  }
}


export function createGitHubWriteGuard(): (pi: ExtensionAPI) => void {
  return function githubWriteGuard(pi: ExtensionAPI): void {
    pi.on("tool_call", async (event, ctx) => {
      if (event.toolName !== "bash" && event.toolName !== "write" && event.toolName !== "github") return;

      const input =
        event.toolName === "github"
          ? { path: "xd://github", content: JSON.stringify(event.input) }
          : event.input;
      const defaultCwd =
        event.toolName === "bash" && typeof event.input.cwd === "string" ? event.input.cwd : ctx.cwd;
      const currentRepository = currentCheckoutRepository(ctx.cwd);
      const decision = guardDecision(input, currentRepository, currentCheckoutRepository(defaultCwd));
      if (decision.allow) return;

      const target = decision.target ?? "an unresolved target";
      const reason = `Blocked ${decision.action} targeting ${target}: ${decision.reason}.`;
      if (!decision.requiresConfirmation) return { block: true, reason };

      const confirmed =
        ctx.hasUI &&
        (await ctx.ui.confirm(
          "Choose GitHub write action",
          `You are in ${currentRepository}. ${decision.action} will write to ${decision.target}. ` +
            "Choose an option because this is a different project.",
        ));
      if (confirmed) return;

      return { block: true, reason: `${reason} Explicit confirmation is required for this operation and target.` };
    });
  };
}

export default createGitHubWriteGuard();
