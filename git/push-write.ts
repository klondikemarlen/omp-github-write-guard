import { executableIndex } from "../shell/executable-index.ts";
import type { GitHubWrite } from "../github/write.ts";

const PUSH_FLAGS: Record<string, true> = {
  "-d": true,
  "-f": true,
  "-q": true,
  "-u": true,
  "-v": true,
  "--all": true,
  "--atomic": true,
  "--delete": true,
  "--dry-run": true,
  "--follow-tags": true,
  "--force": true,
  "--force-if-includes": true,
  "--force-with-lease": true,
  "--mirror": true,
  "--no-thin": true,
  "--no-verify": true,
  "--porcelain": true,
  "--prune": true,
  "--quiet": true,
  "--set-upstream": true,
  "--tags": true,
  "--thin": true,
  "--verbose": true,
};
const GLOBAL_FLAGS: Record<string, true> = { "-P": true, "--no-pager": true, "--paginate": true };
const NON_MUTATING_FLAGS: Record<string, true> = { "-h": true, "-n": true, "--help": true, "--version": true };
const GLOBAL_OPTIONS: Record<string, true> = { "-c": true, "--config": true };

export function gitPushWrite(words: (string | undefined)[]): GitHubWrite | undefined {
  let index = executableIndex(words);
  if (words[index] !== "git") return undefined;

  index += 1;
  const directories: string[] = [];
  while (words[index] !== "push") {
    const word = words[index];
    if (typeof word !== "string") return undefined;
    if (NON_MUTATING_FLAGS[word]) return undefined;
    if (word === "-C") {
      const directory = words[index + 1];
      if (typeof directory !== "string") return undefined;
      directories.push(directory);
      index += 2;
      continue;
    }
    if (word.startsWith("-C") && word.length > 2) {
      directories.push(word.slice(2));
      index += 1;
      continue;
    }
    if (GLOBAL_OPTIONS[word]) {
      if (typeof words[index + 1] !== "string") return undefined;
      index += 2;
      continue;
    }
    if (GLOBAL_FLAGS[word]) {
      index += 1;
      continue;
    }
    return word.startsWith("-") ? { action: "git push", directories, targetUnresolved: true } : undefined;
  }

  if (words.slice(index + 1).some((word) => word === "--dry-run" || typeof word === "string" && NON_MUTATING_FLAGS[word])) return undefined;
  for (index += 1; index < words.length; index += 1) {
    const word = words[index];
    if (typeof word !== "string" || (word.startsWith("-") && !PUSH_FLAGS[word])) {
      return { action: "git push", directories, targetUnresolved: true };
    }
    if (!word.startsWith("-")) return { action: "git push", directories, remote: word };
  }
  return { action: "git push", directories };
}
