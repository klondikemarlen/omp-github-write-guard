import type { ToolCallEvent } from "../extension/contract.ts";
import { authorizationKey } from "./authorization-key.ts";
import {
  confirmationQuestion,
  confirmationQuestionId,
  type BoundaryCategory,
} from "./confirmation-question.ts";

export type AskPayload = {
  questions: [{
    id: string;
    question: string;
    options: { label: string; description: string; preview: null }[];
    header: string;
    multi: false;
  }];
};

export type RepositoryMutationHandoff =
  | { decision: "allow"; action?: string; currentRepository?: string; target?: string }
  | {
      decision: "ask";
      action: string;
      category: BoundaryCategory;
      currentRepository?: string;
      target: string;
      fingerprint: string;
      ask: AskPayload;
    };

export function askHandoff(
  action: string,
  target: string,
  event: ToolCallEvent,
  context: string,
  category: BoundaryCategory,
  currentRepository?: string,
  description?: string,
): Extract<RepositoryMutationHandoff, { decision: "ask" }> {
  const question = confirmationQuestion(action, target, event.input, description, currentRepository, category);
  return {
    decision: "ask",
    action,
    category,
    currentRepository,
    target,
    fingerprint: authorizationKey(action, target, event.input, context),
    ask: {
      questions: [{
        id: confirmationQuestionId,
        question,
        options: [
          { label: "Approve", description: `Allow exactly this ${action} to ${target} once.`, preview: null },
          { label: "Reject", description: "Keep this write blocked.", preview: null },
        ],
        header: "Repository boundary",
        multi: false,
      }],
    },
  };
}
