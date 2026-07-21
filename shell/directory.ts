import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import type { ToolInput } from "../extension/contract.ts";

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

export function toolDirectory(input: ToolInput, sessionCwd: string, commandCwd = sessionCwd): string | undefined {
  if (typeof input.cwd === "string" && input.cwd.trim()) {
    const directory = input.cwd.trim();
    const expanded = directory === "~" || directory.startsWith("~/") ? `${homedir()}${directory.slice(1)}` : directory;
    return isAbsolute(expanded) ? expanded : resolve(sessionCwd, expanded);
  }

  return typeof input.command === "string" ? commandDirectory(input.command, commandCwd) : undefined;
}
