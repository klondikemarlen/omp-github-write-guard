import { parse } from "shell-quote";

const COMMAND_BOUNDARIES: Record<string, true> = { "&&": true, "||": true, ";": true, "|": true, "|&": true, "&": true };
const REDIRECTIONS: Record<string, true> = { "<": true, ">": true, ">>": true, "<&": true, ">&": true, "<<<": true };

const BOUNDARY_OVERRIDE = "OMP_REPOSITORY_BOUNDARY_GUARD_ALLOW_EXTERNAL_MUTATION=1";

export type ShellCommandSegment = {
  words: (string | undefined)[];
  nextOperator?: string;
};

export function shellCommandSegments(command: string): ShellCommandSegment[] {
  try {
    const commands: ShellCommandSegment[] = [];
    let words: (string | undefined)[] = [];
    let nextOperator: string | undefined;
    let discardNext = false;

    for (const token of parse(command, () => ({}))) {
      if (typeof token === "string") {
        if (discardNext) discardNext = false;
        else words.push(token);
        continue;
      }
      if ("comment" in token) break;
      if (!("op" in token) || token.op === "glob") {
        if (discardNext) discardNext = false;
        else words.push(undefined);
        continue;
      }
      if (COMMAND_BOUNDARIES[token.op]) {
        if (words.length) commands.push({ words, nextOperator: token.op });
        words = [];
        nextOperator = undefined;
        discardNext = false;
      } else if (REDIRECTIONS[token.op]) {
        discardNext = true;
      }
    }
    if (words.length) commands.push({ words, nextOperator });
    return commands;
  } catch {
    return [];
  }
}

export function hasBoundaryOverride(command: string): boolean {
  const segments = shellCommandSegments(command);
  if (segments.length !== 1) return false;
  const { words } = segments[0];
  for (let index = 0; typeof words[index] === "string" && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]!); index += 1) {
    if (words[index] === BOUNDARY_OVERRIDE) return true;
  }
  return false;
}

export function shellCommands(command: string): (string | undefined)[][] {
  return shellCommandSegments(command).map(({ words }) => words);
}
