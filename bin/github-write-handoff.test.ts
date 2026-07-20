import { expect, test } from "bun:test";

const external = "elsewhere/example";

test("prints the handoff packet", () => {
  const result = Bun.spawnSync({
    cmd: ["bun", "bin/github-write-handoff.ts"],
    stdin: new TextEncoder().encode(
      JSON.stringify({
        event: {
          toolName: "bash",
          input: { command: `git push https://github.com/${external}.git HEAD` },
        },
      }),
    ),
    stdout: "pipe",
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(result.stdout))).toMatchObject({
    decision: "ask",
    target: external,
    ask: { questions: [{ id: "confirm_external_github_write" }] },
  });
});
