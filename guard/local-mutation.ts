import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import type { ToolCallEvent } from "../extension/contract.ts";
import { currentCheckoutBoundary } from "../git/current-checkout.ts";
import { toolDirectory } from "../shell/directory.ts";

export type LocalMutation = {
  action: string;
  boundary: string;
  targets?: string[];
  reason?: string;
};

function canonicalTarget(path: string, cwd: string): string | undefined {
  let candidate = resolve(cwd, path);
  const missing: string[] = [];

  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) return undefined;
    missing.unshift(basename(candidate));
    candidate = parent;
  }

  try {
    return resolve(realpathSync(candidate), ...missing);
  } catch {
    return undefined;
  }
}

function containingBoundary(path: string): string | undefined {
  let directory = dirname(path);
  while (!existsSync(directory)) {
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
  return currentCheckoutBoundary(directory);
}


function editPaths(input: Record<string, unknown>): string[] | undefined {
  if (typeof input.input !== "string") return undefined;

  const sections = [...input.input.matchAll(/^\[([^#\r\n]+)#[0-9A-F]{4}\]\r?$/gm)];
  if (!sections.length) return undefined;

  const paths: string[] = [];
  for (const [index, section] of sections.entries()) {
    paths.push(section[1]);
    const end = sections[index + 1]?.index ?? input.input.length;
    const body = input.input.slice(section.index! + section[0].length, end);
    for (const move of body.matchAll(/^MV\s+(.+?)\s*$/gm)) paths.push(move[1]);
  }
  return paths;
}

function mutationPaths(event: ToolCallEvent): { action: string; paths: string[] } | undefined {
  if (event.toolName === "write") {
    if (typeof event.input.path !== "string") return { action: "file write", paths: [] };
    if (event.input.path === "xd://github") return undefined;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(event.input.path)) return { action: "file write", paths: [] };
    return { action: "file write", paths: [event.input.path] };
  }

  if (event.toolName !== "edit") return undefined;
  const paths = editPaths(event.input);
  return { action: "file edit", paths: paths ?? [] };
}

export function localMutation(event: ToolCallEvent, sessionCwd: string): LocalMutation | undefined {
  const mutation = mutationPaths(event);
  if (!mutation) return undefined;

  const boundary = currentCheckoutBoundary(sessionCwd);
  if (!boundary) {
    return { action: mutation.action, boundary: sessionCwd, reason: "the active checkout boundary cannot be resolved" };
  }
  if (!mutation.paths.length) {
    return { action: mutation.action, boundary, reason: "the local file target cannot be resolved" };
  }

  const cwd = toolDirectory(event.input, sessionCwd) ?? sessionCwd;
  const targets: string[] = [];
  for (const path of mutation.paths) {
    const target = canonicalTarget(path, cwd);
    if (!target) return { action: mutation.action, boundary, reason: "the local file target cannot be resolved" };
    targets.push(target);
  }

  const externalTargets = [...new Set(targets.filter((target) => containingBoundary(target) !== boundary))];
  return externalTargets.length ? { action: mutation.action, boundary, targets: externalTargets } : undefined;
}
