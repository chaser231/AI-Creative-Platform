/**
 * Unified Style Presets — Single Source of Truth
 *
 * This module defines ALL style presets (image + text) used across the platform:
 * - AIPromptBar (editor direct generation)
 * - ImageContentBlock (wizard step-by-step)
 * - ImageEditorModal (AI editing tools)
 * - Agent orchestrator (search_style_presets action)
 *
 * Presets are workspace-scoped: system presets are available everywhere,
 * workspace custom presets are loaded from the AIPreset DB table.
 */

// ─── Image Style Presets ─────────────────────────────────────────────────────

export type ImageStyleCategory =
  | "photography"   // Продуктовая, Фуд, Лайфстайл, Студийная
  | "digital"       // 3D, Иллюстрация, Градиент, Технологии
  | "artistic"      // Кинематограф, Минимализм, Яркий
  | "custom";       // Пользовательские (workspace-scoped)

export interface ImageStylePreset {
  id: string;
  name: string;
  label: string;            // UI label (localized)
  description: string;
  thumbnailUrl: string;     // path to preview image
  promptSuffix: string;     // injected into image generation prompt
  negativePrompt?: string;  // negative prompt (if model supports it)
  category: ImageStyleCategory;
  isSystem: boolean;        // platform-level (non-deletable)
  order: number;
}

/**
 * System image style presets — merged super-set of wizard + agent defaults.
 * These are always available, regardless of workspace.
 */
export const SYSTEM_IMAGE_PRESETS: ImageStylePreset[] = [
  {
    id: "none",
    name: "none",
    label: "Без стиля",
    description: "Генерация без дополнительного стилевого контекста",
    thumbnailUrl: "/style-presets/none.jpg",
    promptSuffix: "",
    category: "photography",
    isSystem: true,
    order: 0,
  },
  {
    id: "product",
    name: "product",
    label: "Продуктовая",
    description: "Профессиональная студийная съёмка на чистом фоне",
    thumbnailUrl: "/style-presets/product.jpg",
    promptSuffix:
      "Professional commercial product photography on pure white background, studio lighting with soft dramatic shadows, centered composition, crisp detail, clean and premium look.",
    category: "photography",
    isSystem: true,
    order: 1,
  },
  {
    id: "food",
    name: "food",
    label: "Фуд",
    description: "Аппетитная фуд-фотография с тёплым светом",
    thumbnailUrl: "/style-presets/food.jpg",
    promptSuffix:
      "Professional food photography with vibrant appetizing colors, natural organic styling, warm restaurant lighting, shallow depth of field with beautiful bokeh, absolutely mouth-watering presentation.",
    category: "photography",
    isSystem: true,
    order: 2,
  },
  {
    id: "lifestyle",
    name: "lifestyle",
    label: "Лайфстайл",
    description: "Реалистичная фотография в живой обстановке с естественным светом",
    thumbnailUrl: "/style-presets/lifestyle.jpg",
    promptSuffix:
      "Authentic lifestyle brand photography, candid real moments, warm golden hour natural light, casual and approachable atmosphere, genuine emotions, editorial quality.",
    category: "photography",
    isSystem: true,
    order: 3,
  },
  {
    id: "studio",
    name: "studio",
    label: "Студийная",
    description: "Профессиональная студийная съёмка с мягким светом",
    thumbnailUrl: "/style-presets/product.jpg",
    promptSuffix:
      "professional studio photography, clean white/gray background, product hero shot, soft studio lighting, commercial quality",
    category: "photography",
    isSystem: true,
    order: 4,
  },
  {
    id: "tech",
    name: "tech",
    label: "Технологии",
    description: "Футуристичный стиль с неоновым свечением и тёмными тонами",
    thumbnailUrl: "/style-presets/tech.jpg",
    promptSuffix:
      "Futuristic technology product photography, sleek on dark background with neon digital glow elements, circuit and data visualization accents, premium high-tech aesthetic.",
    category: "digital",
    isSystem: true,
    order: 5,
  },
  {
    id: "3d",
    name: "3d",
    label: "3D Рендер",
    description: "3D-сцена с мягкими тенями и изометрической перспективой",
    thumbnailUrl: "/style-presets/tech.jpg",
    promptSuffix:
      "3D rendered scene, soft ambient occlusion, isometric perspective, clean shadows, modern 3D design",
    category: "digital",
    isSystem: true,
    order: 6,
  },
  {
    id: "illustration",
    name: "illustration",
    label: "Иллюстрация",
    description: "Современная цифровая иллюстрация с плоскими цветами",
    thumbnailUrl: "/style-presets/vibrant.jpg",
    promptSuffix:
      "modern digital illustration, bold flat colors, clean vector style, contemporary design",
    category: "digital",
    isSystem: true,
    order: 7,
  },
  {
    id: "gradient",
    name: "gradient",
    label: "Градиент",
    description: "Абстрактный градиентный фон с яркими современными цветами",
    thumbnailUrl: "/style-presets/vibrant.jpg",
    promptSuffix:
      "abstract gradient background, vibrant modern colors, soft color transitions, premium feel",
    category: "digital",
    isSystem: true,
    order: 8,
  },
  {
    id: "minimal",
    name: "minimal",
    label: "Минимализм",
    description: "Минималистичная композиция с максимальным негативным пространством",
    thumbnailUrl: "/style-presets/minimal.jpg",
    promptSuffix:
      "Extreme minimalism photography, single subject on vast clean background, maximum negative space, zen-like aesthetic, ultra clean and simple composition, timeless and refined.",
    category: "artistic",
    isSystem: true,
    order: 9,
  },
  {
    id: "vibrant",
    name: "vibrant",
    label: "Яркий",
    description: "Яркие насыщенные цвета в стиле поп-арт",
    thumbnailUrl: "/style-presets/vibrant.jpg",
    promptSuffix:
      "Bold vibrant pop art style, explosive vivid colors, high saturation, energetic and eye-catching visual impact, playful graphic design aesthetic with maximum visual contrast.",
    category: "artistic",
    isSystem: true,
    order: 10,
  },
  {
    id: "cinematic",
    name: "cinematic",
    label: "Кинематограф",
    description: "Кинематографичный стиль с драматичным освещением и цветокоррекцией",
    thumbnailUrl: "/style-presets/cinematic.jpg",
    promptSuffix:
      "Epic cinematic photography with dramatic film-grade color grading, blue-orange teal LUT, wide aspect ratio feel, atmospheric moody lighting, film grain texture, Hollywood blockbuster aesthetic.",
    category: "artistic",
    isSystem: true,
    order: 11,
  },
];

// ─── Text Style Presets ──────────────────────────────────────────────────────

export type TextStyleCategory = "tone" | "length" | "custom";

export interface TextStylePreset {
  id: string;
  name: string;
  label: string;
  description: string;
  instruction: string;      // system prompt instruction for text generation
  icon: string;             // emoji icon for UI
  category: TextStyleCategory;
  isSystem: boolean;
  order: number;
}

/**
 * System text style presets — unified from TextGenPreset type + PRESET_INSTRUCTIONS.
 * These control the tone and style of AI-generated text (headlines, subs, CTAs).
 */
export const SYSTEM_TEXT_PRESETS: TextStylePreset[] = [
  {
    id: "selling",
    name: "selling",
    label: "Продающий",
    description: "Продающе, с призывом к действию и акцентом на выгоду",
    instruction:
      "Пиши продающе, с призывом к действию и акцентом на выгоду. Текст должен мотивировать на покупку.",
    icon: "💰",
    category: "tone",
    isSystem: true,
    order: 0,
  },
  {
    id: "informational",
    name: "informational",
    label: "Информационный",
    description: "Нейтрально, с фокусом на факты и характеристики",
    instruction:
      "Пиши информативно, нейтрально, с фокусом на факты и характеристики.",
    icon: "📋",
    category: "tone",
    isSystem: true,
    order: 1,
  },
  {
    id: "emotional",
    name: "emotional",
    label: "Эмоциональный",
    description: "Яркие образы, метафоры, вызывает эмоции",
    instruction:
      "Пиши эмоционально, используй яркие образы и метафоры, вызывай эмоции.",
    icon: "❤️",
    category: "tone",
    isSystem: true,
    order: 2,
  },
  {
    id: "short",
    name: "short",
    label: "Короткий",
    description: "Максимально кратко — 2-3 слова",
    instruction: "Пиши максимально кратко — не более 2-3 слов.",
    icon: "⚡",
    category: "length",
    isSystem: true,
    order: 3,
  },
  {
    id: "long",
    name: "long",
    label: "Развёрнутый",
    description: "1-2 предложения с деталями и описанием",
    instruction:
      "Пиши развёрнуто — 1-2 предложения с деталями и описанием.",
    icon: "📝",
    category: "length",
    isSystem: true,
    order: 4,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Category labels for image styles (used in UI grouping) */
export const IMAGE_CATEGORY_LABELS: Record<ImageStyleCategory, string> = {
  photography: "📸 Фото",
  digital: "🎭 Цифровые",
  artistic: "✨ Художественные",
  custom: "🎨 Свои стили",
};

/** Category labels for text styles */
export const TEXT_CATEGORY_LABELS: Record<TextStyleCategory, string> = {
  tone: "🎯 Тон",
  length: "📏 Длина",
  custom: "🎨 Свои стили",
};

/**
 * DB preset shape (from AIPreset table).
 * Config JSON is expected to have these fields.
 */
export interface DBPresetConfig {
  promptSuffix?: string;
  negativePrompt?: string;
  instruction?: string;   // for text presets
  defaultModel?: string;
  icon?: string;
}

/**
 * Merge system image presets with workspace presets from DB.
 * DB presets with matching system IDs override the system version.
 * Custom DB presets are appended at the end.
 */
export function mergeImagePresets(
  dbPresets: Array<{
    id: string;
    name: string;
    description: string;
    config: unknown;
    isActive?: boolean;
    thumbnailUrl?: string | null;
    category?: string;
    order?: number;
  }>,
): ImageStylePreset[] {
  const dbMap = new Map(dbPresets.map((p) => [p.id, p]));
  const result: ImageStylePreset[] = [];

  // System presets first (allow DB overrides)
  for (const sys of SYSTEM_IMAGE_PRESETS) {
    const dbOverride = dbMap.get(sys.id);
    if (dbOverride) {
      const cfg = dbOverride.config as DBPresetConfig;
      result.push({
        ...sys,
        name: dbOverride.name || sys.name,
        description: dbOverride.description || sys.description,
        promptSuffix: cfg?.promptSuffix ?? sys.promptSuffix,
        negativePrompt: cfg?.negativePrompt ?? sys.negativePrompt,
      });
      dbMap.delete(sys.id);
    } else {
      result.push(sys);
    }
  }

  // Append remaining custom DB presets
  const customs = [...dbMap.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const dbPreset of customs) {
    const cfg = dbPreset.config as DBPresetConfig;
    result.push({
      id: dbPreset.id,
      name: dbPreset.name,
      label: dbPreset.name,
      description: dbPreset.description,
      thumbnailUrl: dbPreset.thumbnailUrl || "/style-presets/none.jpg",
      promptSuffix: cfg?.promptSuffix || "",
      negativePrompt: cfg?.negativePrompt,
      category: (dbPreset.category as ImageStyleCategory) || "custom",
      isSystem: false,
      order: dbPreset.order ?? 100,
    });
  }

  return result;
}

/**
 * Merge system text presets with workspace presets from DB.
 */
export function mergeTextPresets(
  dbPresets: Array<{
    id: string;
    name: string;
    description: string;
    config: unknown;
    category?: string;
    order?: number;
  }>,
): TextStylePreset[] {
  const dbMap = new Map(dbPresets.map((p) => [p.id, p]));
  const result: TextStylePreset[] = [];

  for (const sys of SYSTEM_TEXT_PRESETS) {
    const dbOverride = dbMap.get(sys.id);
    if (dbOverride) {
      const cfg = dbOverride.config as DBPresetConfig;
      result.push({
        ...sys,
        label: dbOverride.name || sys.label,
        description: dbOverride.description || sys.description,
        instruction: cfg?.instruction ?? sys.instruction,
      });
      dbMap.delete(sys.id);
    } else {
      result.push(sys);
    }
  }

  const customs = [...dbMap.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const dbPreset of customs) {
    const cfg = dbPreset.config as DBPresetConfig;
    result.push({
      id: dbPreset.id,
      name: dbPreset.name,
      label: dbPreset.name,
      description: dbPreset.description,
      instruction: cfg?.instruction || "",
      icon: cfg?.icon || "✨",
      category: (dbPreset.category as TextStyleCategory) || "custom",
      isSystem: false,
      order: dbPreset.order ?? 100,
    });
  }

  return result;
}

/**
 * Get the prompt suffix for a given image preset ID.
 * Searches the provided list, falling back to system presets.
 */
export function getImagePresetPromptSuffix(
  presetId: string,
  presets?: ImageStylePreset[],
): string {
  const list = presets ?? SYSTEM_IMAGE_PRESETS;
  return list.find((p) => p.id === presetId)?.promptSuffix ?? "";
}

/**
 * Get the instruction for a given text preset ID.
 */
export function getTextPresetInstruction(
  presetId: string,
  presets?: TextStylePreset[],
): string {
  const list = presets ?? SYSTEM_TEXT_PRESETS;
  return list.find((p) => p.id === presetId)?.instruction ?? "";
}

/**
 * Group image presets by category for UI rendering.
 */
export function groupImagePresetsByCategory(
  presets: ImageStylePreset[],
): Record<ImageStyleCategory, ImageStylePreset[]> {
  const groups: Record<ImageStyleCategory, ImageStylePreset[]> = {
    photography: [],
    digital: [],
    artistic: [],
    custom: [],
  };
  for (const p of presets) {
    if (p.id === "none") continue; // "none" is always separate
    groups[p.category].push(p);
  }
  return groups;
}
