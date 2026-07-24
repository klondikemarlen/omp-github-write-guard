import { expect, test } from "bun:test";

import { boundaryPolicy } from "./policy.ts";

const variable = "OMP_REPOSITORY_BOUNDARY_GUARD_EXEMPT_CATEGORIES";

test("parses explicit categories with whitespace and duplicates", () => {
  const previous = process.env[variable];
  process.env[variable] = " local, github,local ";
  try {
    expect([...boundaryPolicy().exemptions]).toEqual(["local", "github"]);
  } finally {
    if (previous === undefined) delete process.env[variable];
    else process.env[variable] = previous;
  }
});

test("rejects unknown categories without partial exemptions", () => {
  const previous = process.env[variable];
  process.env[variable] = "github,unknown";
  try {
    const policy = boundaryPolicy();
    expect(policy.error).toContain("unknown category");
    expect(policy.exemptions.size).toBe(0);
  } finally {
    if (previous === undefined) delete process.env[variable];
    else process.env[variable] = previous;
  }
});
