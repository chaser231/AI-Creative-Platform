import type { CanvasInstruction } from "../actionRegistry";

// ─── Types ───────────────────────────────────────────────

export interface AgentStep {
  actionId: string;
  actionName: string;
  parameters: Record<string, unknown>;
  status: "pending" | "running" | "done" | "error";
  result?: import("../actionRegistry").ActionResult;
}

export interface ModelPreferences {
  textModel?: string;
  imageModel?: string;
  /** Reference images to inject into image generation steps (base64) */
  referenceImages?: string[];
  /** Selected style preset ID (from search_style_presets) */
  stylePresetId?: string;
  /** Style preset prompt suffix to inject into image generation */
  stylePromptSuffix?: string;
}

export interface AgentPlan {
  reasoning: string;
  steps: AgentStep[];
}

export interface AgentResponse {
  plan: AgentPlan;
  textResponse: string;
  provider: "openai" | "fal" | "replicate" | "direct";
  /** All canvas instructions from all steps, aggregated for client execution */
  canvasActions: CanvasInstruction[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
