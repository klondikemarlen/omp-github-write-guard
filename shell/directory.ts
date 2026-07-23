import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import type { ToolInput } from "../extension/contract.ts";
import { shellCommandSegments } from "./commands.ts";

export type DirectoryResolution = string | { unresolved: true } | undefined;

function unquoteDirectory(directory: string): string | undefined {
  return /[$`(){}*?\[\]]/.test(directory) ? undefined : directory;
}

function commandDirectory(command: string, cwd: string): DirectoryResolution {
  let current = cwd;
  let changed = false;
  for (const segment of shellCommandSegments(command)) {
    let index = 0;
    while (typeof segment.words[index] === "string" && /^[A-Za-z_][A-Za-z0-9_]*=/.test(segment.words[index]!)) index += 1;
    const executable = segment.words[index];
    if (executable === "gh" || executable === "git") break;
    if (segment.nextOperator && !["&&", ";"].includes(segment.nextOperator)) return { unresolved: true };
    if (executable !== "cd") continue;

    const directory = segment.words[index + 1] === "--" ? segment.words[index + 2] : segment.words[index + 1];
    if (typeof directory !== "string" || (segment.words[index + 1] === "--" ? segment.words[index + 3] : segment.words[index + 2]) !== undefined) {
      return { unresolved: true };
    }
    const parsed = unquoteDirectory(directory);
    if (!parsed) return { unresolved: true };
    const expanded = parsed === "~" || parsed.startsWith("~/") ? `${homedir()}${parsed.slice(1)}` : parsed;
    current = resolve(current, expanded);
    changed = true;
  }
  return changed ? current : undefined;
}

export function toolDirectory(input: ToolInput, sessionCwd: string, commandCwd = sessionCwd): DirectoryResolution {
  if (typeof input.cwd === "string" && input.cwd.trim()) {
    const directory = input.cwd.trim();
    const expanded = directory === "~" || directory.startsWith("~/") ? `${homedir()}${directory.slice(1)}` : directory;
    return resolve(sessionCwd, expanded);
  }

  return typeof input.command === "string" ? commandDirectory(input.command, commandCwd) : undefined;
}
