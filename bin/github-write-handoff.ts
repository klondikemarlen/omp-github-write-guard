import { githubWriteHandoff, type ToolCallEvent } from "../index.ts";

const request: unknown = JSON.parse(await Bun.stdin.text());
if (
  typeof request !== "object" ||
  request === null ||
  !("event" in request) ||
  typeof request.event !== "object" ||
  request.event === null ||
  !("toolName" in request.event) ||
  typeof request.event.toolName !== "string" ||
  !("input" in request.event) ||
  typeof request.event.input !== "object" ||
  request.event.input === null
) {
  throw new Error('Expected JSON: {"event":{"toolName":string,"input":object},"cwd"?:string}.');
}

const cwd = "cwd" in request && typeof request.cwd === "string" ? request.cwd : process.cwd();
process.stdout.write(`${JSON.stringify(githubWriteHandoff(request.event as ToolCallEvent, cwd))}\n`);
