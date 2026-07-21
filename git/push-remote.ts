import { remoteRepository } from "../github/remote-repository.ts";
import { gitCommandOutput } from "./command.ts";

export function pushRepository(cwd: string, remote: string): string | undefined {
  return remoteRepository(gitCommandOutput(cwd, ["remote", "get-url", "--push", remote]));
}

export function defaultPushRemote(cwd: string): string {
  const branch = gitCommandOutput(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return (
    (branch && gitCommandOutput(cwd, ["config", "--get", `branch.${branch}.pushRemote`])) ??
    gitCommandOutput(cwd, ["config", "--get", "remote.pushDefault"]) ??
    (branch && gitCommandOutput(cwd, ["config", "--get", `branch.${branch}.remote`])) ??
    "origin"
  );
}
