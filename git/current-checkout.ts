import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import { remoteRepository } from "../github/remote-repository.ts";
import { gitCommandOutput } from "./command.ts";

export function currentCheckoutRoot(cwd: string): string | undefined {
  const root = gitCommandOutput(cwd, ["rev-parse", "--show-toplevel"]);
  try {
    return root && realpathSync(root);
  } catch {
    return undefined;
  }
}

export function currentCheckoutRepository(cwd: string): string | undefined {
  const root = currentCheckoutRoot(cwd);
  return root ? remoteRepository(gitCommandOutput(root, ["remote", "get-url", "origin"])) : undefined;
}

export function currentCheckoutBoundary(cwd: string): string | undefined {
  const repository = currentCheckoutRepository(cwd);
  if (repository) return repository;

  const commonDirectory = gitCommandOutput(cwd, ["rev-parse", "--git-common-dir"]);
  try {
    return commonDirectory && realpathSync(resolve(cwd, commonDirectory));
  } catch {
    return undefined;
  }
}
