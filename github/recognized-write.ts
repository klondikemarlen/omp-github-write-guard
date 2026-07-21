import type { ToolInput } from "../extension/contract.ts";
import { githubCliWrite } from "./cli-write.ts";
import { githubDeviceWrite } from "./device-write.ts";
import type { GitHubWrite } from "./write.ts";

export function recognizedGitHubWrite(input: ToolInput, words?: (string | undefined)[]): GitHubWrite | undefined {
  return words ? githubCliWrite(words) : githubDeviceWrite(input);
}
