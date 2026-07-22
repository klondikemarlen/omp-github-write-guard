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
  expect(state.consume("key")).toBe(true);
  expect(state.consume("key")).toBe(false);
});

test("clears approval when the retry changes", () => {
  const state = new AuthorizationState();
  state.resetFor("/checkout");
  state.begin("key", question);
  state.record(approval(["Approve"]));
  expect(state.consume("different")).toBe(false);
  expect(state.consume("key")).toBe(false);
});

test("clears pending authorization when the checkout changes", () => {
  const state = new AuthorizationState();
  state.resetFor("/checkout");
  state.begin("key", question);
  state.resetFor("/other-checkout");
  expect(state.begin("next", question)).toBe(true);
});
