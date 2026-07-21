import { remoteRepository } from "../github/remote-repository.ts";
import { gitCommandOutput } from "./command.ts";

export function pushRepository(cwd: string, remote: string): string | undefined {
  return remoteRepository(gitCommandOutput(cwd, ["remote", "get-url", "--push", remote]));
}
