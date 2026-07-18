import { expect, test } from "bun:test";

import { createGitHubWriteGuard } from "./index.ts";

for (const operation of [
  "same-origin git push",
  "same-origin push opening a draft pull request",
  "same-origin push after a project edits itself",
]) {
  test(`does not intercept ${operation}`, () => {
    const events: string[] = [];

    createGitHubWriteGuard()({
      on: (event) => events.push(event),
    });

    expect(events).toEqual([]);
  });
}
