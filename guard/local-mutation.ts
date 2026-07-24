import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { ToolCallEvent } from "../extension/contract.ts";
import { currentCheckoutBoundary } from "../git/current-checkout.ts";
import { toolDirectory } from "../shell/directory.ts";

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export type LocalMutation = {
  action: string;
  boundary: string;
  targets: string[];
};

function canonicalTarget(path: string, cwd: string): string | undefined {
  let candidate = resolve(cwd, path);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const parts = candidate.split(sep).filter(Boolean);
    let current: string = sep;
    let restarted = false;
    let missingIndex = parts.length;

    for (let index = 0; index < parts.length; index += 1) {
      const next = resolve(current, parts[index]);
      let stat;
      try {
        stat = lstatSync(next);
      } catch {
        missingIndex = index;
        break;
      }

      if (stat.isSymbolicLink()) {
        let link: string;
        try {
          link = readlinkSync(next);
        } catch {
          return undefined;
        }
        candidate = resolve(isAbsolute(link) ? link : dirname(next), link, ...parts.slice(index + 1));
        restarted = true;
        break;
      }
      current = next;
    }

    if (restarted) continue;
    try {
      return resolve(realpathSync(current), ...parts.slice(missingIndex));
    } catch {
      return undefined;
    }
  }

  return undefined;
}

const REGISTERED_INTERNAL_TARGETS: Record<string, true> = {
  "xd://github": true,
  "xd://browser": true,
  "xd://lsp": true,
  "xd://report_issue": true,
  "xd://recall": true,
  "xd://retain": true,
  "xd://reflect": true,
  "xd://memory_edit": true,
  "xd://learner_file_ticket": true,
};

function isRegisteredInternalTarget(path: string): boolean {
  return Object.hasOwn(REGISTERED_INTERNAL_TARGETS, path) || path.startsWith("skill://");
}

const URI_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const FILE_URI = /^file:/i;

function localTarget(path: string): string | undefined {
  if (!URI_SCHEME.test(path) && !FILE_URI.test(path)) return path;
  if (!FILE_URI.test(path)) return undefined;
  try {
    return fileURLToPath(path);
  } catch {
    return undefined;
  }
}


function isTemporaryTarget(path: string): boolean {
  let temporaryRoot: string;
  try {
    temporaryRoot = realpathSync(tmpdir());
  } catch {
    return false;
  }

  const fromTemporaryRoot = relative(temporaryRoot, path);
  return (
    fromTemporaryRoot === "" ||
    (!isAbsolute(fromTemporaryRoot) &&
      fromTemporaryRoot !== ".." &&
      !fromTemporaryRoot.startsWith(`..${sep}`))
  );
}


function containingBoundary(path: string): string | undefined {
  let directory = dirname(path);
  while (!pathExists(directory)) {
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
  while (pathExists(directory)) {
    try {
      if (!lstatSync(directory).isSymbolicLink()) return currentCheckoutBoundary(directory);
    } catch {
      return undefined;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
  return undefined;
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
    if (isRegisteredInternalTarget(event.input.path)) return undefined;
    const path = localTarget(event.input.path);
    return path ? { action: "file write", paths: [path] } : { action: "file write", paths: [] };
  }

  if (event.toolName !== "edit") return undefined;
  const paths = editPaths(event.input);
  if (!paths) return { action: "file edit", paths: [] };
  const localPaths: string[] = [];
  for (const path of paths) {
    if (isRegisteredInternalTarget(path)) continue;
    const localPath = localTarget(path);
    if (!localPath) return { action: "file edit", paths: [] };
    localPaths.push(localPath);
  }
  return localPaths.length ? { action: "file edit", paths: localPaths } : undefined;
}

export function localMutation(event: ToolCallEvent, sessionCwd: string): LocalMutation | undefined {
  const mutation = mutationPaths(event);
  if (!mutation) return undefined;

  const boundary = currentCheckoutBoundary(sessionCwd);
  if (!boundary || !mutation.paths.length) return undefined;

  const resolvedCwd = toolDirectory(event.input, sessionCwd);
  if (resolvedCwd && typeof resolvedCwd !== "string") return undefined;
  const cwd = resolvedCwd ?? sessionCwd;
  const sources: string[] = [];
  const targets: string[] = [];
  for (const path of mutation.paths) {
    const source = resolve(cwd, path);
    const target = canonicalTarget(path, cwd);
    if (!target) return undefined;
    sources.push(source);
    targets.push(target);
  }

  const externalTargets = [
    ...new Set(
      targets.filter((target, index) => {
        const targetBoundary = containingBoundary(target);
        const sourceBoundary = containingBoundary(sources[index]);
        return targetBoundary !== boundary && !(isTemporaryTarget(target) && !targetBoundary && !sourceBoundary);
      }),
    ),
  ];
  return externalTargets.length ? { action: mutation.action, boundary, targets: externalTargets } : undefined;
}
