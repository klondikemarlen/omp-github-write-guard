import { parse } from "shell-quote";

const COMMAND_BOUNDARIES: Record<string, true> = { "&&": true, "||": true, ";": true, "|": true, "|&": true, "&": true };
const REDIRECTIONS: Record<string, true> = { "<": true, ">": true, ">>": true, "<&": true, ">&": true, "<<<": true };

export function shellCommands(command: string): (string | undefined)[][] {
  try {
    const commands: (string | undefined)[][] = [];
    let words: (string | undefined)[] = [];
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
        if (words.length) commands.push(words);
        words = [];
        discardNext = false;
      } else if (REDIRECTIONS[token.op]) {
        discardNext = true;
      }
    }
    if (words.length) commands.push(words);
    return commands;
  } catch {
    return [];
  }
}
