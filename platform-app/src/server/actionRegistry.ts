/**
 * Action Registry
 *
 * Typed catalog of all atomic actions that the AI Agent can perform.
 * Each action has a JSON Schema for its parameters and an execute function.
 *
 * V2: Creative-aware actions designed for banner/creative production.
 * Actions are granular: separate headline, subtitle, image generation.
 * Agent returns canvas instructions that the client executes.
 */

import type { PrismaClient } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────

export interface ActionParameter {
  type: string;
  description: string;
  enum?: string[];
  required?: boolean;
}

export interface ActionDefinition {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, ActionParameter>;
  required: string[];
}

export interface ActionContext {
  userId: string;
  workspaceId: string;
  projectId?: string;
  prisma: PrismaClient;
}

export interface FallbackAction {
  id: string;
  label: string;
  icon: string;
}

export interface ActionResult {
  success: boolean;
  type: "text" | "image" | "data" | "error" | "canvas_action" | "template_choices" | "fallback_actions";
  content: string;
  metadata?: Record<string, unknown>;
  /** Instructions for the client-side canvas */
  canvasActions?: CanvasInstruction[];
  /** Template choices for user to select */
  templateChoices?: Array<{
    id: string;
    name: string;
    description: string;
    thumbnailUrl?: string;
  }>;
  /** Fallback actions when templates not found */
  fallbackActions?: FallbackAction[];
}

/** Instruction for the client to execute on the canvas */
export interface CanvasInstruction {
  action: "add_text" | "add_image" | "add_rectangle" | "load_template" | "update_layer";
  params: Record<string, unknown>;
}

// ─── Action Definitions ──────────────────────────────────

export const ACTIONS: ActionDefinition[] = [
  {
    id: "generate_headline",
    name: "Генерация заголовка",
    description: "Генерирует КОРОТКИЙ заголовок для баннера (3-7 слов). Используй для основного текста баннера.",
    parameters: {
      topic: { type: "string", description: "Тема заголовка (акция, продукт, событие)" },
      tone: { type: "string", description: "Тон: bold, playful, formal, urgent", enum: ["bold", "playful", "formal", "urgent"] },
    },
    required: ["topic"],
  },
  {
    id: "generate_subtitle",
    name: "Генерация подзаголовка",
    description: "Генерирует подзаголовок/описание для баннера (10-20 слов). Дополняет заголовок деталями.",
    parameters: {
      topic: { type: "string", description: "Тема подзаголовка" },
      headline: { type: "string", description: "Заголовок, к которому нужен подзаголовок" },
    },
    required: ["topic"],
  },
  {
    id: "generate_image",
    name: "Генерация изображения",
    description: "Генерирует фоновое изображение для баннера. Автоматически формирует промпт на английском для модели.",
    parameters: {
      subject: { type: "string", description: "Что изобразить (продукт, сцена, фон)" },
      style: { type: "string", description: "Стиль: photo, illustration, 3d, flat, gradient", enum: ["photo", "illustration", "3d", "flat", "gradient"] },
      model: { type: "string", description: "Модель для генерации (по умолчанию flux-schnell). Варианты: flux-schnell, flux-dev, flux-1.1-pro, flux-2-pro, dall-e-3, nano-banana, seedream" },
    },
    required: ["subject"],
  },
  {
    id: "place_on_canvas",
    name: "Размещение на холсте",
    description: "Размещает сгенерированный контент (текст, изображение) на холсте редактора. Вызывай ПОСЛЕ генерации.",
    parameters: {
      elements: {
        type: "string",
        description: "JSON-массив элементов для размещения. Каждый элемент: {type: 'text'|'image', content: '...', role: 'headline'|'subtitle'|'background'}",
      },
    },
    required: ["elements"],
  },
  {
    id: "search_templates",
    name: "Поиск шаблонов",
    description: "Ищет шаблоны баннеров по сервису или ключевому слову. Используй КОГДА пользователь просит баннер для конкретного сервиса (Маркет, Лавка, Еда, Go). Возвращает список шаблонов для выбора.",
    parameters: {
      service: { type: "string", description: "Сервис: market, food, go, lavka, или произвольный текст для поиска" },
    },
    required: ["service"],
  },
  {
    id: "apply_and_fill_template",
    name: "Применение и заполнение шаблона",
    description: "Применяет выбранный шаблон на холст и генерирует контент для всех слотов шаблона (заголовок, подзаголовок, изображение). Вызывай ПОСЛЕ того, как пользователь выбрал шаблон.",
    parameters: {
      templateId: { type: "string", description: "ID выбранного шаблона" },
      topic: { type: "string", description: "Тема для генерации контента" },
    },
    required: ["templateId", "topic"],
  },
  {
    id: "create_project",
    name: "Создание проекта",
    description: "Создаёт новый проект в текущем воркспейсе.",
    parameters: {
      name: { type: "string", description: "Название проекта" },
      goal: { type: "string", description: "Цель: banner, text, video", enum: ["banner", "text", "video"] },
    },
    required: ["name"],
  },
];

/**
 * Convert action definitions to OpenAI function calling format.
 */
export function actionsToOpenAITools() {
  return ACTIONS.map((action) => ({
    type: "function" as const,
    function: {
      name: action.id,
      description: action.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(action.parameters).map(([key, param]) => [
            key,
            {
              type: param.type,
              description: param.description,
              ...(param.enum ? { enum: param.enum } : {}),
            },
          ])
        ),
        required: action.required,
      },
    },
  }));
}

/**
 * Get a concise action list for system prompts.
 */
export function actionsDescription(): string {
  return ACTIONS.map(
    (a) => `- ${a.id}: ${a.description}`
  ).join("\n");
}
