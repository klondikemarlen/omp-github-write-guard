import { realpathSync } from "node:fs";

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
