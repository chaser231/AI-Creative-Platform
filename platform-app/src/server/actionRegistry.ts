/**
 * Action Registry
 *
 * Typed catalog of all atomic actions that the AI Agent can perform.
 * Each action has a JSON Schema for its parameters and an execute function.
 * This is the foundation for both saved workflows and the AI orchestrator.
 */

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
  /** Which parameters are required */
  required: string[];
}

export interface ActionContext {
  userId: string;
  workspaceId: string;
  projectId?: string;
  /** Prisma client */
  prisma: any;
}

export interface ActionResult {
  success: boolean;
  type: "text" | "image" | "data" | "error";
  content: string;
  metadata?: Record<string, unknown>;
}

// ─── Action Definitions (for OpenAI function calling) ────

export const ACTIONS: ActionDefinition[] = [
  {
    id: "generate_text",
    name: "Генерация текста",
    description: "Генерирует текст (рекламный копирайт, заголовки, описания) с помощью AI-модели. Используй для создания текстового контента.",
    parameters: {
      prompt: { type: "string", description: "Текстовый промпт — что нужно сгенерировать" },
      style: { type: "string", description: "Стиль текста: formal, casual, creative, marketing", enum: ["formal", "casual", "creative", "marketing"] },
    },
    required: ["prompt"],
  },
  {
    id: "generate_image",
    name: "Генерация изображения",
    description: "Генерирует изображение (баннер, фото, иллюстрацию) с помощью AI-модели. Используй для визуального контента.",
    parameters: {
      prompt: { type: "string", description: "Описание изображения для генерации" },
      style: { type: "string", description: "Стиль: photo, illustration, 3d, flat", enum: ["photo", "illustration", "3d", "flat"] },
    },
    required: ["prompt"],
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
  {
    id: "apply_template",
    name: "Применение шаблона",
    description: "Применяет шаблон из библиотеки к текущему проекту.",
    parameters: {
      templateName: { type: "string", description: "Название или описание нужного шаблона" },
    },
    required: ["templateName"],
  },
  {
    id: "edit_image",
    name: "Редактирование изображения",
    description: "Редактирует изображение: inpaint (замена части), remove-bg (удаление фона), outpaint (расширение).",
    parameters: {
      action: { type: "string", description: "Действие: inpaint, remove-bg, outpaint", enum: ["inpaint", "remove-bg", "outpaint"] },
      prompt: { type: "string", description: "Описание редактирования" },
    },
    required: ["action"],
  },
  {
    id: "export_project",
    name: "Экспорт проекта",
    description: "Экспортирует текущий проект в указанный формат.",
    parameters: {
      format: { type: "string", description: "Формат экспорта: png, jpg, webp, pdf", enum: ["png", "jpg", "webp", "pdf"] },
    },
    required: [],
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
