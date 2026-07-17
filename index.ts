import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type ToolInput = Record<string, unknown>;
type WriteOperation = "issue_create" | "pr_create";
type GitHubWrite = {
  action: string;
  operation?: WriteOperation;
  target?: string;
  resource?: string;
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

export type CreationPolicy = "allow" | "confirm";
export type GuardPolicy = {
  issueCreationPolicies?: Record<string, CreationPolicy>;
  pullRequestCreationPolicies?: Record<string, CreationPolicy>;
};

export const DEFAULT_POLICY: Required<GuardPolicy> = {
  issueCreationPolicies: {},
  pullRequestCreationPolicies: {},
};

const GITHUB_WRITE_OPERATIONS: Record<string, true> = {
  pr_create: true,
  pr_push: true,
  pr_checkout: true,
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

    const operation = op === "issue_create" || op === "pr_create" ? op : undefined;
    const head = typeof payload.head === "string" ? payload.head : undefined;
    const target = normalizeRepository(payload.repo);
    return {
      action:
        operation === "issue_create"
          ? "Create GitHub issue"
          : operation === "pr_create"
            ? "Create pull request"
            : op,
      operation,
      target,
      resource: head ? `branch ${head}` : undefined,
      requiresExplicitTarget: Object.hasOwn(payload, "repo") && !target,
    };
  } catch {
    return { action: "GitHub write with unreadable arguments", requiresExplicitTarget: true };
  }
}

function bashGitHubWrite(input: ToolInput): GitHubWrite | undefined {
  if (typeof input.command !== "string") return undefined;
  const command = input.command;
  const target = repositoryTarget(command);
  const head = command.match(/--head(?:=|\s+)([^\s]+)/)?.[1];
  const resource = head ? `branch ${head}` : undefined;
  const apiWrite =
    /\bgh\s+api\b/.test(command) &&
    (/(?:\s-X|\s--method)(?:\s+|=)(?:POST|PUT|PATCH|DELETE)\b/i.test(command) ||
      /\s(?:-f|--field|--raw-field|--input)(?:\s+|=)/.test(command));

  if (/\bgh\s+issue\s+create\b/.test(command)) {
    return {
      action: "Create GitHub issue",
      operation: "issue_create",
      target,
      requiresExplicitTarget: hasRepositoryOption(command) && !target,
    };
  }
  if (/\bgh\s+pr\s+create\b/.test(command)) {
    return {
      action: "Create pull request",
      operation: "pr_create",
      target,
      resource,
      requiresExplicitTarget: hasRepositoryOption(command) && !target,
    };
  }
  if (apiWrite && /\brepos\/[^/\s]+\/[^/\s?#]+\/issues(?:[?\s]|$)/i.test(command)) {
    return { action: "Create GitHub issue", operation: "issue_create", target };
  }
  if (apiWrite && /\brepos\/[^/\s]+\/[^/\s?#]+\/pulls(?:[?\s]|$)/i.test(command)) {
    return { action: "Create pull request", operation: "pr_create", target, resource };
  }
  if (/\bgh\s+repo\s+(?:fork|create|edit|delete|rename|archive|unarchive)\b/.test(command)) {
    return {
      action: "repository action",
      target,
      requiresExplicitTarget:
        (hasRepositoryOption(command) || /\bgh\s+repo\s+\w+\s+[^\s-]/.test(command)) && !target,
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
    return {
      action: "git push",
      target: normalizeRepository(remote),
      requiresExplicitTarget: /\bgit\s+push\s+\S+/.test(command) && (!remote || remote !== "origin"),
    };
  }

  return undefined;
}

function normalizedCreationPolicies(value: unknown): Record<string, CreationPolicy> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).flatMap(([target, mode]) => {
      const repository = normalizeRepository(target);
      return repository && (mode === "allow" || mode === "confirm") ? [[repository, mode]] : [];
    }),
  );
}

function resolvedPolicy(policy: GuardPolicy = {}): Required<GuardPolicy> {
  return {
    issueCreationPolicies: normalizedCreationPolicies(policy.issueCreationPolicies),
    pullRequestCreationPolicies: normalizedCreationPolicies(policy.pullRequestCreationPolicies),
  };
}

export type GuardDecision =
  | { allow: true }
  | {
      allow: false;
      action: string;
      target?: string;
      reason: string;
      requiresConfirmation?: true;
      confirmationKey?: string;
      unresolvedTarget?: true;
    };
export function guardDecision(
  input: ToolInput,
  policy: GuardPolicy = {},
  currentRepository?: string,
  defaultRepository = currentRepository,
): GuardDecision {
  const write = githubDeviceWrite(input) ?? bashGitHubWrite(input);
  if (!write) return { allow: true };

  const configuredPolicy = resolvedPolicy(policy);
  const target = write.target ?? defaultRepository;
  const confirmationKey =
    write.operation && target && !write.requiresExplicitTarget ? `${write.operation}\0${target}` : undefined;
  const needsConfirmation = (reason: string): GuardDecision => ({
    allow: false,
    action: write.action,
    target,
    reason,
    requiresConfirmation: true,
    confirmationKey,
    unresolvedTarget: write.requiresExplicitTarget ? true : undefined,
  });

  if (write.operation && target === currentRepository && !write.requiresExplicitTarget) return { allow: true };

  if (write.operation && target) {
    const mode =
      write.operation === "issue_create"
        ? configuredPolicy.issueCreationPolicies[target]
        : configuredPolicy.pullRequestCreationPolicies[target];
    return mode === "allow" ? { allow: true } : needsConfirmation("the creation policy requires confirmation");
  }

  if (!currentRepository) return needsConfirmation("the current checkout has no resolvable origin repository");
  if (write.target && write.target !== currentRepository) {
    return needsConfirmation(`the target differs from the current checkout (${currentRepository})`);
  }
  if (write.requiresExplicitTarget) {
    return needsConfirmation("the target cannot be proven to be the current checkout");
  }
  if (!write.target && !defaultRepository) {
    return needsConfirmation("the command's default target cannot be proven to be the current checkout");
  }
  if (!write.target && defaultRepository !== currentRepository) {
    return needsConfirmation(`the target differs from the current checkout (${currentRepository})`);
  }

  return { allow: true };
}

function confirmationPrompt(
  decision: Extract<GuardDecision, { allow: false }>,
  currentRepository?: string,
): string {
  const target = decision.target ?? "an unresolved target";
  const unresolvedTarget = decision.unresolvedTarget === true || decision.target === undefined;
  const current = currentRepository ?? "an unresolved project";
  const writesElsewhere = !unresolvedTarget && decision.target !== currentRepository;
  const location = unresolvedTarget
    ? `You are in ${current}. ${decision.action} has no resolvable GitHub target.`
    : `You are in ${current}. ${decision.action} will create a GitHub artifact in ${target}.`;
  const purpose = unresolvedTarget
    ? "Choose an option because the target cannot be proven to be this project."
    : writesElsewhere
      ? "Choose an option because this is a different project."
      : "Choose an option because this is this project.";
  const remembered = decision.confirmationKey
    ? " Approval is remembered for this action and target for the rest of this session."
    : "";
  const reasonSuffix = unresolvedTarget ? "" : ` ${decision.reason}.`;

  return `${location} ${purpose}${remembered}${reasonSuffix}`;
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

function readObject(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function pluginPolicy(path: string): GuardPolicy {
  const settings = readObject(path)?.settings;
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return {};
  const pluginSettings = (settings as Record<string, unknown>)["omp-github-write-guard"];
  if (typeof pluginSettings !== "object" || pluginSettings === null || Array.isArray(pluginSettings)) return {};

  const parse = (value: unknown): Record<string, CreationPolicy> =>
    normalizedCreationPolicies(typeof value === "string" ? (() => {
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    })() : value);
  const values = pluginSettings as Record<string, unknown>;
  return {
    ...(Object.hasOwn(values, "issueCreationPolicies") && { issueCreationPolicies: parse(values.issueCreationPolicies) }),
    ...(Object.hasOwn(values, "pullRequestCreationPolicies") && {
      pullRequestCreationPolicies: parse(values.pullRequestCreationPolicies),
    }),
  };
}

export function loadPolicy(
  path = process.env.OMP_GITHUB_WRITE_GUARD_CONFIG,
  homeDirectory = homedir(),
  pluginSettingsPath = join(homeDirectory, ".omp", "plugins", "omp-plugins.lock.json"),
): GuardPolicy {
  const policyPath = path === undefined ? join(homeDirectory, ".omp", "agent", "github-write-guard.json") : path;
  const localPolicy = policyPath ? readObject(policyPath) : undefined;
  return { ...localPolicy, ...pluginPolicy(pluginSettingsPath) };
}

export function createGitHubWriteGuard(policy: GuardPolicy = {}): (pi: ExtensionAPI) => void {
  return function githubWriteGuard(pi: ExtensionAPI): void {
    const approvedConfirmations = new Set<string>();
    const configuredPolicy = resolvedPolicy(policy);
    pi.on("tool_call", async (event, ctx) => {
      if (event.toolName !== "bash" && event.toolName !== "write" && event.toolName !== "github") return;

      const input =
        event.toolName === "github"
          ? { path: "xd://github", content: JSON.stringify(event.input) }
          : event.input;
      const defaultCwd =
        event.toolName === "bash" && typeof event.input.cwd === "string" ? event.input.cwd : ctx.cwd;
      const currentRepository = currentCheckoutRepository(ctx.cwd);
      const decision = guardDecision(
        input,
        configuredPolicy,
        currentRepository,
        currentCheckoutRepository(defaultCwd),
      );
      if (decision.allow) return;

      const target = decision.target ?? "an unresolved target";
      const reason = `Blocked ${decision.action} targeting ${target}: ${decision.reason}.`;
      if (!decision.requiresConfirmation) return { block: true, reason };

      if (decision.confirmationKey && approvedConfirmations.has(decision.confirmationKey)) return;

      const prompt = confirmationPrompt(decision, currentRepository);
      const confirmed = ctx.hasUI && (await ctx.ui.confirm("Choose GitHub write action", prompt));
      if (confirmed) {
        if (decision.confirmationKey) approvedConfirmations.add(decision.confirmationKey);
        return;
      }

      return { block: true, reason: `${reason} Explicit confirmation is required for this operation and target.` };
    });
  };
}

export default createGitHubWriteGuard(loadPolicy());
