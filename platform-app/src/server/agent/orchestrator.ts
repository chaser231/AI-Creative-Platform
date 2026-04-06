import { ACTIONS } from "../actionRegistry";
import type { ActionContext, CanvasInstruction } from "../actionRegistry";
import type { AgentStep, AgentResponse, ChatMessage, ModelPreferences } from "./types";
import { getActiveProvider, callLLM, callOpenAIWithTools, callReplicateWithTools } from "./llmProviders";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { executeAction } from "./executeAction";
import { analyzeReferenceImages } from "./visionAnalyzer";

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

  // ── VLM Vision Pre-step ──────────────────────────────────────────
  // If the user uploaded reference images, call a VLM first to produce
  // textual descriptions. These are injected into the system context so
  // the text-only planning LLM can reason about the visual content.
  let visionContextStr = "";
  if (modelPreferences?.referenceImages && modelPreferences.referenceImages.length > 0) {
    console.log(`[Pipeline ▶2 VLM] Calling analyzeReferenceImages for ${modelPreferences.referenceImages.length} image(s)...`);
    const visionResult = await analyzeReferenceImages(
      modelPreferences.referenceImages,
      userMessage
    );
    if (visionResult.imageCount > 0) {
      visionContextStr = `\n\n⚠️ ВИЗУАЛЬНЫЙ КОНТЕКСТ (загруженные референсы):\n${visionResult.combinedSummary}\n\nИнструкция: Используй эти описания при составлении промптов для генерации изображений. Описывай объекты конкретно.`;
      console.log(`[Pipeline ▶2 VLM] Vision analysis DONE. Summary (first 200 chars): ${visionResult.combinedSummary.slice(0, 200)}`);
    }
  }

  const systemContent = SYSTEM_PROMPT + contextInfo + visionContextStr;
  console.log(`[Pipeline ▶3 LLM] System context length: ${systemContent.length} chars, has vision context: ${visionContextStr.length > 0}`);

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
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
      if (step.actionId === "generate_image") {
        if (modelPreferences?.imageModel) {
          step.parameters.model = modelPreferences.imageModel;
        }
        if (modelPreferences?.referenceImages && modelPreferences.referenceImages.length > 0) {
          step.parameters.referenceImages = modelPreferences.referenceImages;
          console.log(`[Pipeline ▶4 Orchestrator] Injecting ${modelPreferences.referenceImages.length} referenceImages into generate_image step`);
        }
        // Inject VLM descriptions directly into subject so prompt engineer has exact product details
        if (visionContextStr) {
          const existingSubject = (step.parameters.subject as string) || "";
          step.parameters.subject = `${existingSubject}\n\nТОЧНЫЕ ОПИСАНИЯ ТОВАРОВ ИЗ РЕФЕРЕНСНЫХ ФОТО:\n${visionContextStr}`;
          console.log(`[Pipeline ▶4 Orchestrator] Enriched subject with VLM descriptions (${visionContextStr.length} chars)`);
        }
        // Inject style preset prompt suffix if one was selected
        if (modelPreferences?.stylePromptSuffix) {
          const existingSubject = (step.parameters.subject as string) || "";
          step.parameters.subject = `${existingSubject}\n\nСТИЛЬ ГЕНЕРАЦИИ: ${modelPreferences.stylePromptSuffix}`;
          console.log(`[Pipeline ▶4 Orchestrator] Injected style preset: "${modelPreferences.stylePromptSuffix.slice(0, 80)}..."`);
        }
      }

      // Inject reference images into apply_and_fill_template too
      if (step.actionId === "apply_and_fill_template") {
        if (modelPreferences?.imageModel) {
          step.parameters.imageModel = modelPreferences.imageModel;
        }
        if (modelPreferences?.referenceImages && modelPreferences.referenceImages.length > 0) {
          step.parameters.referenceImages = modelPreferences.referenceImages;
          console.log(`[Pipeline ▶4 Orchestrator] Injecting ${modelPreferences.referenceImages.length} referenceImages into apply_and_fill_template step`);
        }
        if (visionContextStr) {
          step.parameters.visionContext = visionContextStr;
          console.log(`[Pipeline ▶4 Orchestrator] Injecting VLM context (${visionContextStr.length} chars) into template filler`);
        }
        if (modelPreferences?.stylePromptSuffix) {
          step.parameters.stylePromptSuffix = modelPreferences.stylePromptSuffix;
        }
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
