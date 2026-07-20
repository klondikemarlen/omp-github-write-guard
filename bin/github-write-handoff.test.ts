import { execFileSync } from "node:child_process";
import { expect, test } from "bun:test";

const current = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" })
  .trim()
  .replace(/^.*github\.com[/:]/i, "")
  .replace(/\.git$/, "")
  .toLowerCase();
const external = "elsewhere/example";

function handoff(command: string) {
  const result = Bun.spawnSync({
    cmd: ["bun", "bin/github-write-handoff.ts"],
    stdin: new TextEncoder().encode(JSON.stringify({ event: { toolName: "bash", input: { command } } })),
    stdout: "pipe",
  });
  expect(result.exitCode).toBe(0);
  return JSON.parse(new TextDecoder().decode(result.stdout));
}

test("prints every GitHub write decision", () => {
  expect(handoff("git push origin HEAD")).toMatchObject({ decision: "allow", target: current });
  expect(handoff(`git push https://github.com/${external}.git HEAD`)).toMatchObject({
    decision: "ask",
    target: external,
    ask: { questions: [{ id: "confirm_external_github_write" }] },
  });
  expect(handoff('gh issue create --repo "$TARGET"')).toMatchObject({ decision: "block" });
  expect(handoff("git status --short")).toMatchObject({ decision: "allow" });
});
