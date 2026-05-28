/**
 * Per-model prompt construction for AI inpaint.
 *
 * The inpaint surface has two intents:
 *
 *   - "edit"   — user-supplied prompt describes what should appear in the
 *                masked region. We append a per-model style hint so the
 *                generated content blends with the surrounding image.
 *
 *   - "remove" — fixed system prompt that asks the model to erase the
 *                masked object and fill seamlessly with the surrounding
 *                background. User prompt is ignored.
 *
 * Suffixes are tuned per model family because different backends respect
 * different cues:
 *
 *   • FLUX Fill (flux-fill)  — accepts an empty prompt; we still hint at
 *     photorealism + seamless blending for higher fidelity.
 *
 *   • OpenAI GPT Image (gpt-image-2, gpt-image) — strict mask edit; we
 *     remind the model to edit only inside the masked area.
 *
 *   • Google Nano Banana (nano-banana, nano-banana-2, nano-banana-pro) —
 *     semantic mask via image_urls hint; explicit instruction to limit
 *     changes to the masked region helps the model treat the mask as
 *     more than a reference.
 */

import { getModelById } from "./ai-models";

export type InpaintIntent = "edit" | "remove";
export type InpaintPromptProfile = "default" | "outpaint";

/**
 * Output of {@link buildInpaintPrompt}.
 *
 * `prompt` is the string to send to the provider. `effectiveIntent` echoes
 * the resolved intent (defaults to "edit") for downstream logging/UI.
 */
export interface BuiltInpaintPrompt {
    prompt: string;
    effectiveIntent: InpaintIntent;
    effectiveProfile: InpaintPromptProfile;
}

/**
 * Universal object-removal instruction. Tested against flux-fill,
 * gpt-image-2 and nano-banana-2; behaves consistently when the model
 * receives a strict mask. For nano-banana, we additionally lean on the
 * mask hint via `image_urls`.
 */
const REMOVE_BASE = [
    "Remove the object in the masked area completely.",
    "Fill the area seamlessly with the surrounding background,",
    "matching texture, lighting, color, perspective, depth of field,",
    "and shadow direction. Do not add new objects, text, or watermarks.",
].join(" ");

const OUTPAINT_BASE = [
    "Extend the scene naturally into the masked white areas.",
    "Preserve the original subject, composition, text/logos, and perspective.",
].join(" ");

interface PromptProfile {
    /** Appended to the user prompt for "edit" intent. */
    editSuffix?: string;
    /** Suffix appended to REMOVE_BASE for "remove" intent. */
    removeSuffix?: string;
}

const FLUX_FILL_PROFILE: PromptProfile = {
    editSuffix: "Photorealistic result, seamless integration, consistent lighting and perspective.",
    removeSuffix: "Photorealistic clean background, no seams.",
};

const GPT_IMAGE_PROFILE: PromptProfile = {
    editSuffix: "Edit only within the masked area; leave everything else unchanged.",
    removeSuffix: "Edit only within the masked area; keep the rest of the image exactly as is.",
};

const NANO_BANANA_PROFILE: PromptProfile = {
    editSuffix: "Apply the change ONLY to the region indicated by the second image (the mask: white = edit, black = keep). Preserve everything outside the mask exactly.",
    removeSuffix: "Treat the second image as the mask (white = remove, black = keep). Erase only inside the white region; leave the rest pixel-identical.",
};

const DEFAULT_PROFILE: PromptProfile = {
    editSuffix: undefined,
    removeSuffix: undefined,
};

/** Choose a profile based on the model slug family. */
function profileForModel(modelId: string): PromptProfile {
    const entry = getModelById(modelId);
    if (!entry) return DEFAULT_PROFILE;
    const slug = entry.slug;
    if (slug.startsWith("black-forest-labs/") || modelId === "flux-fill") {
        return FLUX_FILL_PROFILE;
    }
    if (slug.startsWith("openai/")) {
        return GPT_IMAGE_PROFILE;
    }
    if (slug.startsWith("google/")) {
        return NANO_BANANA_PROFILE;
    }
    return DEFAULT_PROFILE;
}

/**
 * Build the final prompt string to send to the inpaint provider.
 *
 * Behavior:
 *   - intent="remove" overrides the user prompt entirely with REMOVE_BASE +
 *     per-model removal suffix. We deliberately drop the user prompt here:
 *     mixing "remove X" with arbitrary user text destabilises models like
 *     flux-fill (they sometimes draw a faint version of the requested
 *     object instead of removing it).
 *
 *   - intent="edit" uses the user prompt verbatim, appending only the
 *     per-model style suffix. If the user supplied no prompt, we fall back
 *     to a neutral "seamless natural fill" so flux-fill has something to
 *     latch onto.
 */
export function buildInpaintPrompt({
    model,
    intent = "edit",
    userPrompt,
    promptProfile = "default",
}: {
    model: string;
    intent?: InpaintIntent;
    userPrompt?: string;
    promptProfile?: InpaintPromptProfile;
}): BuiltInpaintPrompt {
    const profile = profileForModel(model);

    if (intent === "remove") {
        const suffix = profile.removeSuffix ? ` ${profile.removeSuffix}` : "";
        return {
            prompt: `${REMOVE_BASE}${suffix}`,
            effectiveIntent: "remove",
            effectiveProfile: "default",
        };
    }

    if (promptProfile === "outpaint") {
        const trimmed = (userPrompt || "").trim();
        const hint = trimmed.length > 0 ? ` User context/style hint: ${trimmed}` : "";
        return {
            prompt: `${OUTPAINT_BASE}${hint}`,
            effectiveIntent: "edit",
            effectiveProfile: "outpaint",
        };
    }

    const trimmed = (userPrompt || "").trim();
    const base = trimmed.length > 0 ? trimmed : "Seamless natural fill that blends with the surrounding image.";
    const suffix = profile.editSuffix ? ` ${profile.editSuffix}` : "";
    return {
        prompt: `${base}${suffix}`,
        effectiveIntent: "edit",
        effectiveProfile: "default",
    };
}

/**
 * Default model recommendation for the inpaint surface.
 *
 * flux-fill is the only model with strict native mask support across all
 * providers and the most predictable for production inpainting. gpt-image-2
 * is the premium alternative; nano-banana-* are experimental (heuristic mask).
 */
export const DEFAULT_INPAINT_MODEL = "flux-fill";

/**
 * Model IDs we recommend exposing in the inpaint model picker, ordered by
 * default preference. Consumers can intersect this with getModelsForCaps("inpaint")
 * to keep the list in sync with the registry.
 */
export const PREFERRED_INPAINT_MODELS = [
    "flux-fill",
    "gpt-image-2",
    "nano-banana-2",
    "nano-banana-pro",
];
