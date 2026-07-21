import { gitCommandOutput } from "./command.ts";

export function defaultPushRemote(cwd: string): string {
  const branch = gitCommandOutput(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return (
    (branch && gitCommandOutput(cwd, ["config", "--get", `branch.${branch}.pushRemote`])) ??
    gitCommandOutput(cwd, ["config", "--get", "remote.pushDefault"]) ??
    (branch && gitCommandOutput(cwd, ["config", "--get", `branch.${branch}.remote`])) ??
    "origin"
  );
}
