import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageData: unknown = JSON.parse(readFileSync("package.json", "utf8"));
if (typeof packageData !== "object" || packageData === null || !("version" in packageData) || typeof packageData.version !== "string" || !/^\d+\.\d+\.\d+$/.test(packageData.version)) {
  throw new Error("package.json must declare a semantic release version");
}
const packageVersion = packageData.version;

let latestTag: string | undefined;
try {
  latestTag = execFileSync("git", ["describe", "--tags", "--abbrev=0"], { encoding: "utf8" }).trim();
} catch {
  latestTag = undefined;
}

if (latestTag) {
  const tagVersion = latestTag.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(tagVersion)) throw new Error(`latest tag ${latestTag} is not a semantic version`);
  const current = packageVersion.split(".").map(Number);
  const previous = tagVersion.split(".").map(Number);
  if (current.every((part, index) => part === previous[index])) {
    throw new Error(`package version ${packageVersion} is unchanged from ${latestTag}; bump it before release`);
  }
}

console.log(`release version ${packageVersion}${latestTag ? ` (after ${latestTag})` : ""}`);
