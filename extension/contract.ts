export type ToolInput = Record<string, unknown>;

export type ToolCallEvent = { toolName: string; input: ToolInput };

export type ToolResultEvent = {
  toolName: string;
  input: ToolInput;
  details: unknown;
  isError: boolean;
};

export type ToolCallResult = { block: true; reason: string } | undefined;

export type HookContext = { cwd: string; hasUI?: boolean };

export type ToolCallHandler = (
  event: ToolCallEvent,
  context: HookContext,
) => ToolCallResult | Promise<ToolCallResult>;

export type ToolResultHandler = (event: ToolResultEvent, context: HookContext) => void;

export type ExtensionAPI = {
  on(event: "tool_call", handler: ToolCallHandler): void;
  on(event: "tool_result", handler: ToolResultHandler): void;
  sendUserMessage(content: string, options: { deliverAs: "steer" }): void;
};
