import type { ToolInput } from "../extension/contract.ts";

export function authorizationKey(action: string, target: string, input: ToolInput, context: string): string {
  // OMP supplies a per-call intent; it may change between the blocked call and its retry.
  const entries = Object.entries(input)
    .filter(([key]) => key !== "i")
    .sort(([left], [right]) => left.localeCompare(right));
  return `${action}\u0000${target}\u0000${context}\u0000${JSON.stringify(entries)}`;
}
