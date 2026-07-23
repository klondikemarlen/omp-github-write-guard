import { expect, test } from "bun:test";

import { AuthorizationState } from "./authorization-state.ts";

const question = "Allow one git push to elsewhere/example?";

function approval(selectedOptions: string[]) {
  return {
    toolName: "ask",
    input: { questions: [{ id: "confirm_repository_boundary_mutation", question }] },
    details: { selectedOptions },
    isError: false,
  };
}

test("authorizes one exact retry", () => {
  const state = new AuthorizationState();
  state.resetFor("/checkout");
  expect(state.begin("key", question)).toBe(true);
  state.record(approval(["Approve"]));
  expect(state.consume("key")).toBe("authorized");
  expect(state.consume("key")).toBe("missing");
});

test("distinguishes and clears a mismatched approval", () => {
  const state = new AuthorizationState();
  state.resetFor("/checkout");
  state.begin("key", question);
  state.record(approval(["Approve"]));
  expect(state.consume("different")).toBe("mismatched");
  expect(state.consume("key")).toBe("missing");
});

test("clears pending authorization when the checkout changes", () => {
  const state = new AuthorizationState();
  state.resetFor("/checkout");
  state.begin("key", question);
  state.resetFor("/other-checkout");
  expect(state.begin("next", question)).toBe(true);
});

test("does not retain an external approval without a pending request", () => {
  const state = new AuthorizationState();
  state.resetFor("/checkout");
  state.record({
    toolName: "ask",
    input: {
      questions: [{ id: "confirm_external_github_write", question: "Allow one GitHub issue creation to elsewhere/example?" }],
    },
    details: { selectedOptions: ["Approve"] },
    isError: false,
  });
  expect(state.consumeExternal("key", "Allow one GitHub issue creation to elsewhere/example?")).toBe(false);
  expect(state.begin("key", "Allow one GitHub issue creation to elsewhere/example?")).toBe(true);
});
