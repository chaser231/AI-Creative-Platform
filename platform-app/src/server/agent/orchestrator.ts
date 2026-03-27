import { ACTIONS } from "../actionRegistry";
import type { ActionContext, CanvasInstruction } from "../actionRegistry";
import type { AgentStep, AgentResponse, ChatMessage, ModelPreferences } from "./types";
import { getActiveProvider, callLLM, callOpenAIWithTools, callReplicateWithTools } from "./llmProviders";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { executeAction } from "./executeAction";

// ─── Main Orchestrator ───────────────────────────────────

export async function interpretAndExecute(
  userMessage: string,
  context: ActionContext,
  workspaceName?: string,
  conversationHistory?: ChatMessage[],
  modelPreferences?: ModelPreferences
): Promise<AgentResponse> {
  const provider = getActiveProvider();
  const contextInfo = workspaceName
    ? `\n\nВоркспейс: «${workspaceName}»`
    : "";

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT + contextInfo },
    ...(conversationHistory || []),
    { role: "user", content: userMessage },
  ];

  // Step 1: Interpret via LLM
  const aiResponse = provider === "openai"
    ? await callOpenAIWithTools(messages)
    : await callReplicateWithTools(messages);

  // Step 2: Build plan
  const steps: AgentStep[] = aiResponse.toolCalls.map((tc) => {
    const action = ACTIONS.find((a) => a.id === tc.name);
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(tc.arguments);
    } catch {
      // ignore
    }

    return {
      actionId: tc.name,
      actionName: action?.name || tc.name,
      parameters: parsedArgs,
      status: "pending" as const,
    };
  });

  // Step 3: Execute sequentially, passing results between steps
  const allCanvasActions: CanvasInstruction[] = [];
  const generatedContent: Record<string, string> = {};

  for (const step of steps) {
    step.status = "running";

    try {
      // Inject content from previous steps into place_on_canvas
      if (step.actionId === "place_on_canvas") {
        const elements: Array<{ type: string; content: string; role: string }> = [];

        if (generatedContent.headline) {
          elements.push({ type: "text", content: generatedContent.headline, role: "headline" });
        }
        if (generatedContent.subtitle) {
          elements.push({ type: "text", content: generatedContent.subtitle, role: "subtitle" });
        }
        if (generatedContent.image) {
          elements.push({ type: "image", content: generatedContent.image, role: "background" });
        }

        step.parameters = { elements: JSON.stringify(elements) };
      }

      // Inject user's model preferences
      if (step.actionId === "generate_image" && modelPreferences?.imageModel) {
        step.parameters.model = modelPreferences.imageModel;
      }

      step.result = await executeAction(step.actionId, step.parameters, context);
      step.status = "done";

      // Track generated content for later steps
      if (step.result.success) {
        if (step.result.metadata?.role === "headline") {
          generatedContent.headline = step.result.content;
        } else if (step.result.metadata?.role === "subtitle") {
          generatedContent.subtitle = step.result.content;
        } else if (step.result.type === "image") {
          generatedContent.image = step.result.content;
        }

        // Collect canvas actions
        if (step.result.canvasActions) {
          allCanvasActions.push(...step.result.canvasActions);
        }
      }
    } catch (e) {
      step.status = "error";
      step.result = {
        success: false,
        type: "error",
        content: e instanceof Error ? e.message : "Ошибка выполнения",
      };
    }
  }

  // Step 4: Response
  const textResponse =
    aiResponse.content ||
    (steps.length > 0
      ? `Выполнено ${steps.filter((s) => s.status === "done").length} из ${steps.length} действий`
      : "Я не понял запрос. Попробуйте переформулировать.");

  return {
    plan: { reasoning: textResponse, steps },
    textResponse,
    provider,
    canvasActions: allCanvasActions,
  };
}

export async function chatResponse(
  userMessage: string,
  conversationHistory?: ChatMessage[]
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(conversationHistory || []),
    { role: "user", content: userMessage },
  ];

  return callLLM(messages);
}
