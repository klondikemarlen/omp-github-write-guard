import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

import { createRepositoryBoundaryGuard, type ToolCallHandler } from "../index.ts";

export const current = "klondikemarlen/omp-repository-boundary-guard";
export const external = "elsewhere/example";
export const confirmationId = "confirm_repository_boundary_mutation";

export type Guard = {
  handler: ToolCallHandler;
  answer(event: { toolName: string; input: Record<string, unknown>; details: unknown; isError: boolean }): void;
  messages: string[];
};

export function guard(): Guard {
  let handler: ToolCallHandler | undefined;
  let resultHandler: Guard["answer"] | undefined;
  const messages: string[] = [];
  createRepositoryBoundaryGuard()({
    on: ((event: string, registered: ToolCallHandler | Guard["answer"]) => {
      if (event === "tool_call") handler = registered as ToolCallHandler;
      else resultHandler = registered as Guard["answer"];
    }) as never,
    sendUserMessage: (message) => messages.push(message),
  });
  return { handler: handler!, answer: (event) => resultHandler!(event), messages };
}

export function checkout(remote: string | null = `https://github.com/${current}.git`) {
  const directory = `/tmp/omp-repository-boundary-guard-${crypto.randomUUID()}`;
  mkdirSync(directory, { recursive: true });
  execFileSync("git", ["-C", directory, "init", "--quiet"]);
  if (remote) execFileSync("git", ["-C", directory, "remote", "add", "origin", remote]);
  return directory;
}

export function context(cwd: string, hasUI = true) {
  return { cwd, hasUI };
}

export function approve(guard: Guard, _action: string, _target: string, _detail = "") {
  const message = guard.messages.at(-1);
  if (!message) throw new Error("missing confirmation request");
  const start = message.indexOf("{");
  const end = message.indexOf("}. If approved", start) + 1;
  const input = JSON.parse(message.slice(start, end)) as Record<string, unknown>;
  guard.answer({
    toolName: "ask",
    input,
    details: { selectedOptions: ["Approve"] },
    isError: false,
  });
}
