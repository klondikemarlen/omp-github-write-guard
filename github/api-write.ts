import type { ToolInput } from "../extension/contract.ts";
import { normalizeRepository } from "./normalize-repository.ts";
import { githubTarget } from "./target.ts";
import type { GitHubWrite } from "./write.ts";

function environmentQuery(input: ToolInput): string | undefined {
  if (typeof input.command !== "string" || typeof input.env !== "object" || input.env === null || Array.isArray(input.env)) return undefined;
  if (/[;&|]/.test(input.command)) return undefined;

  const variables = [...input.command.matchAll(/(?:^|\s)(?:-f|--raw-field)\s+(?:["'])?query=(?:["'])?\$([A-Za-z_][A-Za-z0-9_]*)/g)]
    .map((match) => match[1]);
  const [variable] = variables;
  if (!variable || variables.length !== 1) return undefined;

  const value = (input.env as Record<string, unknown>)[variable];
  if (typeof value === "string") return value;
  return undefined;
}

function graphqlQuery(words: (string | undefined)[], index: number, input: ToolInput): string | undefined {
  for (; index < words.length; index += 1) {
    const word = words[index];
    let value: string | undefined;
    if (word === "--raw-field" || word === "-f") {
      value = words[index + 1];
    } else if (typeof word === "string" && word.startsWith("--raw-field=")) {
      value = word.slice("--raw-field=".length);
    } else if (typeof word === "string" && word.startsWith("-f")) {
      value = word.slice(2);
    }
    if (typeof value !== "string" || !value.startsWith("query=")) continue;
    const query = value.slice("query=".length);
    if (!query || query.startsWith("$")) return environmentQuery(input);
    return query;
  }
  return environmentQuery(input);
}

function githubApiHostnameUnresolved(words: (string | undefined)[], input: ToolInput): boolean {
  const hostnames: string[] = [];
  if (typeof process.env.GH_HOST === "string") hostnames.push(process.env.GH_HOST);
  if (typeof input.env === "object" && input.env !== null && !Array.isArray(input.env)) {
    const hostname = (input.env as Record<string, unknown>).GH_HOST;
    if (typeof hostname === "string") hostnames.push(hostname);
  }

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (typeof word !== "string") continue;
    if (word.startsWith("GH_HOST=")) {
      hostnames.push(word.slice("GH_HOST=".length));
      continue;
    }
    if (word === "--hostname") {
      const hostname = words[index + 1];
      if (typeof hostname !== "string") return true;
      hostnames.push(hostname);
      index += 1;
      continue;
    }
    if (word.startsWith("--hostname=")) hostnames.push(word.slice("--hostname=".length));
  }
  return hostnames.some((hostname) => hostname.toLowerCase() !== "github.com");
}

function graphqlOperation(document: string): "query" | "mutation" | undefined {
  const tokens = graphqlTokens(document);
  if (!tokens) return undefined;

  const operation = graphqlDocumentOperation(tokens);
  if (!operation || operation.kind === "subscription") return undefined;
  return operation.kind;
}

type GraphqlToken = { type: "name" | "string" | "punct"; value: string };

function graphqlTokens(document: string): GraphqlToken[] | undefined {
  const tokens: GraphqlToken[] = [];
  for (let index = 0; index < document.length;) {
    const character = document[index];
    if (/\s|,/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "#") {
      index = document.indexOf("\n", index);
      if (index === -1) break;
      continue;
    }
    if (document.startsWith('"""', index)) {
      const end = document.indexOf('"""', index + 3);
      if (end === -1) return undefined;
      tokens.push({ type: "string", value: document.slice(index + 3, end) });
      index = end + 3;
      continue;
    }
    if (character === '"') {
      let end = index + 1;
      while (end < document.length) {
        if (document[end] === "\\") {
          end += 2;
          continue;
        }
        if (document[end] === '"') break;
        end += 1;
      }
      if (end >= document.length) return undefined;
      try {
        tokens.push({ type: "string", value: JSON.parse(document.slice(index, end + 1)) });
      } catch {
        return undefined;
      }
      index = end + 1;
      continue;
    }
    if (document.startsWith("...", index)) {
      tokens.push({ type: "punct", value: "..." });
      index += 3;
      continue;
    }
    if (character === "-" || /\d/.test(character)) {
      const number = document.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (!number) return undefined;
      index += number[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      const end = document.slice(index).search(/[^A-Za-z0-9_]/);
      const value = end === -1 ? document.slice(index) : document.slice(index, index + end);
      tokens.push({ type: "name", value });
      index += value.length;
      continue;
    }
    if ("!$&():=@[]{}|".includes(character)) {
      tokens.push({ type: "punct", value: character });
      index += 1;
      continue;
    }
    return undefined;
  }
  return tokens;
}

type ReviewThread = { id: string } | { unresolved: true };
type GraphqlSelection = { start: number; end: number };
type GraphqlOperation = { kind: "query" | "mutation" | "subscription"; selection: GraphqlSelection };

function matchingToken(tokens: GraphqlToken[], start: number, opening: string, closing: string): number | undefined {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].value === opening) depth += 1;
    if (tokens[index].value === closing) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function definitionSelection(tokens: GraphqlToken[], start: number): GraphqlSelection | undefined {
  let parentheses = 0;
  let brackets = 0;
  for (let index = start + 1; index < tokens.length; index += 1) {
    if (tokens[index].value === "(") parentheses += 1;
    if (tokens[index].value === ")") parentheses -= 1;
    if (tokens[index].value === "[") brackets += 1;
    if (tokens[index].value === "]") brackets -= 1;
    if (tokens[index].value !== "{" || parentheses !== 0 || brackets !== 0) continue;

    const end = matchingToken(tokens, index, "{", "}");
    if (end === undefined) return undefined;
    return { start: index, end };
  }
  return undefined;
}

function graphqlDocumentOperation(tokens: GraphqlToken[]): GraphqlOperation | undefined {
  if (tokens[0]?.value === "{") {
    const end = matchingToken(tokens, 0, "{", "}");
    if (end === undefined || end !== tokens.length - 1) return undefined;
    return { kind: "query", selection: { start: 0, end } };
  }

  let operationCount = 0;
  let operation: GraphqlOperation | undefined;
  for (let index = 0; index < tokens.length;) {
    const definition = tokens[index];
    if (definition.type !== "name") return undefined;

    const selection = definitionSelection(tokens, index);
    if (!selection) return undefined;

    if (definition.value !== "fragment") {
      if (!["mutation", "query", "subscription"].includes(definition.value)) return undefined;
      operationCount += 1;
      operation = {
        kind: definition.value as GraphqlOperation["kind"],
        selection,
      };
    }
    index = selection.end + 1;
  }
  if (operationCount !== 1) return undefined;
  return operation;
}

function mutationSelection(tokens: GraphqlToken[]): GraphqlSelection | undefined {
  const operation = graphqlDocumentOperation(tokens);
  if (!operation || operation.kind !== "mutation") return undefined;
  return operation.selection;
}

function reviewThreadArgument(tokens: GraphqlToken[], start: number, end: number): string | undefined {
  let threadId: string | undefined;
  for (let index = start + 1; index < end; index += 1) {
    if (tokens[index].type !== "name" || tokens[index].value !== "threadId" || tokens[index + 1]?.value !== ":") continue;

    const value = tokens[index + 2];
    if (!value || value.type !== "string" || threadId) return undefined;
    threadId = value.value;
  }
  return threadId;
}

function afterFieldDirectives(tokens: GraphqlToken[], index: number, end: number): number | undefined {
  while (index < end && tokens[index].value === "@") {
    if (tokens[index + 1]?.type !== "name") return undefined;
    index += 2;
    if (tokens[index]?.value !== "(") continue;

    const directiveEnd = matchingToken(tokens, index, "(", ")");
    if (directiveEnd === undefined || directiveEnd >= end) return undefined;
    index = directiveEnd + 1;
  }
  return index;
}

function selectedReviewThreadId(tokens: GraphqlToken[], selection: GraphqlSelection): string | undefined {
  let index = selection.start + 1;
  let fieldCount = 0;
  let threadId: string | undefined;
  while (index < selection.end) {
    const field = tokens[index];
    if (field.type !== "name") return undefined;

    let fieldName = field.value;
    index += 1;
    if (tokens[index]?.value === ":") {
      const aliasedField = tokens[index + 1];
      if (!aliasedField || aliasedField.type !== "name") return undefined;
      fieldName = aliasedField.value;
      index += 2;
    }
    if (fieldName !== "resolveReviewThread" || tokens[index]?.value !== "(" || fieldCount > 0) return undefined;

    const argumentsEnd = matchingToken(tokens, index, "(", ")");
    if (argumentsEnd === undefined || argumentsEnd >= selection.end) return undefined;
    threadId = reviewThreadArgument(tokens, index, argumentsEnd);
    if (!threadId) return undefined;
    fieldCount += 1;
    const nextField = afterFieldDirectives(tokens, argumentsEnd + 1, selection.end);
    if (nextField === undefined) return undefined;
    index = nextField;

    if (tokens[index]?.value === "{") {
      const responseEnd = matchingToken(tokens, index, "{", "}");
      if (responseEnd === undefined || responseEnd >= selection.end) return undefined;
      index = responseEnd + 1;
    }
  }
  if (fieldCount !== 1) return undefined;
  return threadId;
}

function hasReviewThreadCall(tokens: GraphqlToken[]): boolean {
  return tokens.some((token, index) => token.type === "name" && token.value === "resolveReviewThread" && tokens[index + 1]?.value === "(");
}

function reviewThread(document: string): ReviewThread | undefined {
  const tokens = graphqlTokens(document);
  if (!tokens) {
    if (document.includes("resolveReviewThread")) return { unresolved: true };
    return undefined;
  }

  const selection = mutationSelection(tokens);
  if (!selection) {
    if (hasReviewThreadCall(tokens)) return { unresolved: true };
    return undefined;
  }

  const threadId = selectedReviewThreadId(tokens, selection);
  if (!threadId) {
    if (hasReviewThreadCall(tokens)) return { unresolved: true };
    return undefined;
  }
  return { id: threadId };
}

export function githubApiWrite(words: (string | undefined)[], index: number, input: ToolInput): GitHubWrite | undefined {
  const isGraphQL = words[index] === "graphql";
  let document: string | undefined;
  if (isGraphQL) document = graphqlQuery(words, index + 1, input);

  let thread: ReviewThread | undefined;
  if (isGraphQL && document) thread = reviewThread(document);

  let operation: "query" | "mutation" | undefined;
  if (document) operation = graphqlOperation(document);
  if (operation === "query") return undefined;

  const targetInfo = githubTarget(words, index);
  const hostnameUnresolved = githubApiHostnameUnresolved(words, input);
  let target = targetInfo.target;
  let method = "GET";
  let methodUnresolved = false;
  let hasFields = false;

  for (; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--method" || word === "-X") {
      const value = words[index + 1];
      if (typeof value === "string") method = value.toUpperCase();
      else methodUnresolved = true;
      index += 1;
      continue;
    }
    if (typeof word === "string" && (word.startsWith("--method=") || word.startsWith("-X"))) {
      method = (word.startsWith("--method=") ? word.slice(word.indexOf("=") + 1) : word.slice(2)).toUpperCase();
      continue;
    }
    hasFields ||= word === "--raw-field" || word === "-f" || word === "--field" || word === "-F" || word === "--input" ||
      (typeof word === "string" && (word.startsWith("--raw-field=") || word.startsWith("--field=") || word.startsWith("-f") || word.startsWith("-F")));
    const path = typeof word === "string" ? word.match(/(?:^|\/)repos\/([^/\s]+)\/([^/?\s]+)/i) : undefined;
    if (!target && path) target = normalizeRepository(`${path[1]}/${path[2]}`);
  }

  if (!methodUnresolved && method === "GET" && !hasFields) return undefined;
  let reviewThreadId: string | undefined;
  let reviewThreadUnresolved: boolean | undefined;
  if (thread) {
    if ("id" in thread) reviewThreadId = thread.id;
    if ("unresolved" in thread) reviewThreadUnresolved = true;
  }

  return {
    action: "GitHub API write",
    target,
    targetUnresolved: targetInfo.targetUnresolved || hostnameUnresolved || (!target && !thread),
    reviewThreadId,
    reviewThreadUnresolved,
  };
}
