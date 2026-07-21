import { normalizeRepository } from "./repository.ts";
import { githubTarget } from "./target.ts";
import type { GitHubWrite } from "./write.ts";

export function githubApiWrite(words: (string | undefined)[], index: number): GitHubWrite | undefined {
  const targetInfo = githubTarget(words, index);
  let target = targetInfo.target;
  let method = "GET";
  let methodUnresolved = false;
  let hasFields = false;

  for (; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--method" || word === "-X") {
      const value = words[index + 1];
      if (typeof value === "string") method = value.toUpperCase();
      else methodUnresolved = true;
      index += 1;
      continue;
    }
    if (typeof word === "string" && (word.startsWith("--method=") || word.startsWith("-X"))) {
      method = (word.startsWith("--method=") ? word.slice(word.indexOf("=") + 1) : word.slice(2)).toUpperCase();
      continue;
    }
    hasFields ||= word === "--raw-field" || word === "-f" || word === "--field" || word === "-F" || word === "--input" ||
      (typeof word === "string" && (word.startsWith("--raw-field=") || word.startsWith("--field=") || word.startsWith("-f") || word.startsWith("-F")));
    const path = typeof word === "string" ? word.match(/(?:^|\/)repos\/([^/\s]+)\/([^/?\s]+)/i) : undefined;
    if (!target && path) target = normalizeRepository(`${path[1]}/${path[2]}`);
  }

  if (!methodUnresolved && method === "GET" && !hasFields) return undefined;
  return { action: "GitHub API write", target, targetUnresolved: targetInfo.targetUnresolved || !target };
}
