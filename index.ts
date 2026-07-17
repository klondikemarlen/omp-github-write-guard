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

export type GuardPolicy = {
  trustedOwners?: string[];
  allowOwnedIssueCreation?: boolean;
  blockExternalPullRequests?: boolean;
};

export const DEFAULT_POLICY: Required<GuardPolicy> = {
  trustedOwners: [],
  allowOwnedIssueCreation: false,
  blockExternalPullRequests: false,
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
    return {
      action:
        operation === "issue_create"
          ? "Create GitHub issue"
          : operation === "pr_create"
            ? "Create pull request"
            : op,
      operation,
      target: normalizeRepository(payload.repo),
      resource: head ? `branch ${head}` : undefined,
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
    return { action: "Create GitHub issue", operation: "issue_create", target };
  }
  if (/\bgh\s+pr\s+create\b/.test(command)) {
    return { action: "Create pull request", operation: "pr_create", target, resource };
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

function resolvedPolicy(policy: GuardPolicy = {}): Required<GuardPolicy> {
  const trustedOwners = Array.isArray(policy.trustedOwners)
    ? policy.trustedOwners.filter((owner): owner is string => typeof owner === "string").map((owner) => owner.toLowerCase())
    : [];
  return {
    trustedOwners,
    allowOwnedIssueCreation:
      typeof policy.allowOwnedIssueCreation === "boolean"
        ? policy.allowOwnedIssueCreation
        : DEFAULT_POLICY.allowOwnedIssueCreation,
    blockExternalPullRequests:
      typeof policy.blockExternalPullRequests === "boolean"
        ? policy.blockExternalPullRequests
        : DEFAULT_POLICY.blockExternalPullRequests,
  };
}

function isTrustedOwner(target: string | undefined, policy: Required<GuardPolicy>): boolean {
  return Boolean(target && policy.trustedOwners.includes(target.split("/", 1)[0]!));
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
  const blocks = (reason: string): GuardDecision => ({ allow: false, action: write.action, target, reason });

  if (write.operation === "issue_create" && target && isTrustedOwner(target, configuredPolicy)) {
    return configuredPolicy.allowOwnedIssueCreation ? { allow: true } : needsConfirmation("owned issue creation requires confirmation");
  }
  if (write.operation === "pr_create" && target) {
    if (isTrustedOwner(target, configuredPolicy)) {
      return needsConfirmation("pull-request creation requires target-specific authorization");
    }
    if (configuredPolicy.blockExternalPullRequests) {
      return blocks("pull-request creation outside the trusted owners is denied");
    }
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

export function loadPolicy(
  path = process.env.OMP_GITHUB_WRITE_GUARD_CONFIG,
  homeDirectory = homedir(),
): GuardPolicy {
  const policyPath = path === undefined ? join(homeDirectory, ".omp", "agent", "github-write-guard.json") : path;
  if (!policyPath) return DEFAULT_POLICY;
  try {
    const parsed: unknown = JSON.parse(readFileSync(policyPath, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as GuardPolicy) : DEFAULT_POLICY;
  } catch {
    return DEFAULT_POLICY;
  }
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

      const unresolvedTarget = decision.unresolvedTarget === true || decision.target === undefined;
      const writesElsewhere = !unresolvedTarget && decision.target !== currentRepository;
      const location = unresolvedTarget
        ? `${decision.action} names a GitHub target that could not be resolved.`
        : writesElsewhere
          ? `${decision.action} will write a GitHub artifact to ${target}, not the current checkout ${currentRepository ?? "repository"}.`
          : `${decision.action} will write a GitHub artifact to the current checkout ${target}.`;
      const purpose = unresolvedTarget
        ? "Approval is required because the target cannot be proven to be the current checkout."
        : writesElsewhere
          ? "Approval prevents accidental writes to an unrelated repository."
          : "Approval confirms that this target-specific write is intentional.";
      const remembered = decision.confirmationKey
        ? " Approval is remembered for this action and target for the rest of this session."
        : "";
      const reasonSuffix = unresolvedTarget ? "" : ` ${decision.reason}.`;
      const prompt = `${location} ${purpose}${remembered}${reasonSuffix}`;
      const confirmed = ctx.hasUI && (await ctx.ui.confirm("Confirm GitHub write", prompt));
      if (confirmed) {
        if (decision.confirmationKey) approvedConfirmations.add(decision.confirmationKey);
        return;
      }

      return { block: true, reason: `${reason} Explicit confirmation is required for this operation and target.` };
    });
  };
}

export default createGitHubWriteGuard(loadPolicy());
