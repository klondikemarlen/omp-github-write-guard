import { normalizeRepository } from "./normalize-repository.ts";

const VALUE_FLAGS: Record<string, true> = {
  "--title": true, "-t": true, "--body": true, "-b": true, "--comment": true, "-c": true, "--label": true, "-l": true,
  "--milestone": true, "-m": true, "--assignee": true, "-a": true, "--project": true, "--author": true, "--reviewer": true,
  "--branch": true, "--base": true, "--head": true, "--file": true, "--input": true, "--field": true, "-F": true,
  "--raw-field": true, "-f": true, "--method": true, "-X": true, "--hostname": true,
};

function repositoryValue(word: string): string | undefined {
  return normalizeRepository(word) ?? word.match(/github\.com[/:]([^/\s]+)\/([^/\s]+)/i)?.slice(1).join("/");
}

function flagHasValue(word: string): boolean {
  return Object.keys(VALUE_FLAGS).some((flag) => word.startsWith(`${flag}=`));
}
const NON_MUTATING_FLAGS: Record<string, true> = { "-h": true, "--help": true, "--version": true };

export function isHelpRequest(words: (string | undefined)[], index: number): boolean {
  let skipNext = false;
  for (; index < words.length; index += 1) {
    const word = words[index];
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (typeof word !== "string") continue;
    if (NON_MUTATING_FLAGS[word]) return true;
    if (Object.hasOwn(VALUE_FLAGS, word) || flagHasValue(word)) skipNext = !word.includes("=");
  }
  return false;
}

export function githubTarget(words: (string | undefined)[], index: number, title?: string) {
  let target: string | undefined;
  let targetUnresolved = false;
  let description: string | undefined;
  let bodyDescription: string | undefined;
  let explicitTarget = false;
  let skipNext = false;

  for (; index < words.length; index += 1) {
    const word = words[index];
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (word === "--repo" || word === "-R") {
      const repository = words[index + 1];
      if (typeof repository !== "string" || repository.startsWith("-")) {
        targetUnresolved = true;
      } else {
        const normalized = normalizeRepository(repository);
        targetUnresolved ||= !normalized;
        if (normalized) target = normalized;
        explicitTarget = true;
      }
      skipNext = true;
      continue;
    }
    if (typeof word === "string" && (word.startsWith("--repo=") || word.startsWith("-R="))) {
      const normalized = normalizeRepository(word.slice(word.indexOf("=") + 1));
      targetUnresolved ||= !normalized;
      if (normalized) target = normalized;
      explicitTarget = true;
      continue;
    }
    if (word === "--title" || word === "-t") {
      const value = words[index + 1];
      if (title && typeof value === "string" && !value.startsWith("-")) description = `${title}: ${value}`;
      skipNext = true;
      continue;
    }
    if (typeof word === "string" && (word.startsWith("--title=") || word.startsWith("-t="))) {
      if (title) description = `${title}: ${word.slice(word.indexOf("=") + 1)}`;
      continue;
    }
    if (word === "--body" || word === "-b") {
      const value = words[index + 1];
      if (title && typeof value === "string" && !value.startsWith("-")) {
        bodyDescription = `Body: ${value.length > 400 ? `${value.slice(0, 400)}…` : value}`;
      }
      skipNext = true;
      continue;
    }
    if (typeof word === "string" && (word.startsWith("--body=") || word.startsWith("-b="))) {
      if (title) {
        const value = word.slice(word.indexOf("=") + 1);
        bodyDescription = `Body: ${value.length > 400 ? `${value.slice(0, 400)}…` : value}`;
      }
      continue;
    }
    if (typeof word !== "string") continue;
    if (Object.hasOwn(VALUE_FLAGS, word) || flagHasValue(word)) {
      skipNext = !word.includes("=");
      continue;
    }
    if (word.startsWith("-")) {
      const next = words[index + 1];
      if (/(?:body|comment|label|milestone|input|field|file|title|description|message|text)(?:-[a-z]+)*(?:=|$)/i.test(word)) {
        skipNext = !word.includes("=");
        continue;
      }
      if (typeof next === "string" && repositoryValue(next)) targetUnresolved = true;
      skipNext = true;
      continue;
    }
    if (!explicitTarget) target ||= repositoryValue(word) && normalizeRepository(repositoryValue(word));
  }
  if (bodyDescription) description = [description, bodyDescription].filter((detail): detail is string => Boolean(detail)).join("\n");
  return { target, targetUnresolved, description };
}
