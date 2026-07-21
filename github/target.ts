import { normalizeRepository } from "./repository.ts";

export function githubTarget(words: (string | undefined)[], index: number, title?: string) {
  let target: string | undefined;
  let targetUnresolved = false;
  let description: string | undefined;

  for (; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--repo" || word === "-R") {
      const repository = words[index + 1];
      if (typeof repository !== "string" || repository.startsWith("-")) targetUnresolved = true;
      else {
        target = normalizeRepository(repository);
        targetUnresolved ||= !target;
      }
      index += 1;
      continue;
    }
    if (typeof word === "string" && (word.startsWith("--repo=") || word.startsWith("-R="))) {
      target = normalizeRepository(word.slice(word.indexOf("=") + 1));
      targetUnresolved ||= !target;
      continue;
    }
    if (word === "--title" || word === "-t") {
      const value = words[index + 1];
      if (title && typeof value === "string" && !value.startsWith("-")) description = `${title}: ${value}`;
      index += 1;
      continue;
    }
    if (typeof word === "string" && (word.startsWith("--title=") || word.startsWith("-t="))) {
      if (title) description = `${title}: ${word.slice(word.indexOf("=") + 1)}`;
      continue;
    }
    if (typeof word === "string") {
      const repository = normalizeRepository(word) ?? word.match(/github\.com[/:]([^/\s]+)\/([^/\s]+)/i)?.slice(1).join("/");
      target ||= repository && normalizeRepository(repository);
    }
  }
  return { target, targetUnresolved, description };
}
