import { remoteRepository } from "../github/remote-repository.ts";
import { gitCommandOutput } from "./command.ts";

export function currentCheckoutRepository(cwd: string): string | undefined {
  const root = gitCommandOutput(cwd, ["rev-parse", "--show-toplevel"]);
  return root ? remoteRepository(gitCommandOutput(root, ["remote", "get-url", "origin"])) : undefined;
}
