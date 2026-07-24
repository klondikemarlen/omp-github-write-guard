import { parse } from "shell-quote";

const COMMAND_BOUNDARIES: Record<string, true> = { "&&": true, "||": true, ";": true, "|": true, "|&": true, "&": true };
const REDIRECTIONS: Record<string, true> = { "<": true, ">": true, ">>": true, "<&": true, ">&": true, "<<<": true };


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


export function shellCommands(command: string): (string | undefined)[][] {
  return shellCommandSegments(command).map(({ words }) => words);
}
