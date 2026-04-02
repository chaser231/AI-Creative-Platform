export interface AIChatMessage {
    id: string;
    role: "user" | "assistant";
    type: "text" | "image" | "outpaint" | "plan" | "error" | "template_choices" | "fallback_actions" | "text_variants" | "preset_choices";
    content: string;
    prompt?: string;
    timestamp: number;
    /** Agent plan steps (only for plan-type messages) */
    steps?: Array<{
        actionId: string;
        actionName: string;
        status: "pending" | "running" | "done" | "error";
        result?: { type: string; content: string };
    }>;
    /** Template choices (only for template_choices-type messages) */
    templateChoices?: Array<{
        id: string;
        name: string;
        description: string;
        thumbnailUrl?: string;
    }>;
    /** Original topic for template application */
    templateTopic?: string;
    /** Fallback action buttons */
    fallbackActions?: Array<{
        id: string;
        label: string;
        icon: string;
    }>;
    /** Text variant options (Market templates) */
    textVariants?: Array<{
        title: string;
        subtitle: string;
    }>;
    /** Currently active variant index */
    activeVariantIndex?: number;
    /** Reference images attached by user (base64 strings) */
    attachments?: string[];
    /** Style preset choices (from search_style_presets) */
    presetChoices?: Array<{
        id: string;
        name: string;
        description: string;
        promptSuffix: string;
    }>;
}
