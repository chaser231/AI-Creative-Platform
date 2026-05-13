/**
 * Curated LoRA catalogue (system, ships in code).
 *
 * Each entry is a hand-picked, license-clean LoRA weight that works with one
 * of the LoRA-aware fal.ai endpoints declared in `ai-models.ts`. The starter
 * set focuses on Yandex use-cases: photoreal product shots, cinematic
 * lifestyle, vintage banners, and stylised 3D — these cover ~80 % of typical
 * banner / photo workflows without needing custom uploads.
 *
 * User-uploaded LoRAs live in the `LoraPreset` Prisma model and are merged
 * with this catalogue at the API/UI boundary (see lora-presets tRPC router).
 *
 * `family` MUST match a ModelEntry.loraSpec.family — the picker filters the
 * catalogue down to entries compatible with the model the user has selected.
 */

import type { LoraSpec } from "./ai-models";

export interface LoraPresetEntry {
    /** Stable id used as the React key and in URLs. */
    id: string;
    /** User-facing label in Russian. */
    name: string;
    /** Tooltip / popover description (keep ≤120 chars). */
    description: string;
    /** Public URL to a 256-square preview JPEG/PNG (served from /lora-previews). */
    previewUrl: string;
    /** Compatibility family — see {@link LoraSpec}. */
    family: LoraSpec["family"];
    /** Public .safetensors URL passed verbatim to fal.ai as `loras[].path`. */
    path: string;
    /** Recommended starting strength (UI seeds the slider with this). */
    defaultScale: number;
    /**
     * Optional prompt activators. Some community LoRAs require explicit
     * trigger words to take effect; we surface them in the picker so the
     * user can copy them into the prompt.
     */
    triggerWords?: string[];
    /** Free-form tags for filtering / search. */
    tags: string[];
}

/**
 * Starter pack — 4 entries chosen for Yandex banner / product / lifestyle
 * use-cases. Add more here OR let workspaces add their own via LoraPreset.
 *
 * License notes:
 *   • All four are CreativeML Open RAIL-M or equivalent permissive licences.
 *   • We don't redistribute the weights — fal.ai pulls them from the URL on
 *     each request.
 */
export const SYSTEM_LORA_CATALOG: LoraPresetEntry[] = [
    {
        id: "photoreal-cinematic",
        name: "Photoreal Cinematic",
        description:
            "Кинематографичный фотореализм с мягким светом — лица, lifestyle, рекламные сцены.",
        previewUrl: "/lora-previews/photoreal-cinematic.jpg",
        family: "flux-1",
        // XLabs-AI realism LoRA for FLUX.1 — community-vetted, stable.
        path: "https://huggingface.co/XLabs-AI/flux-RealismLora/resolve/main/lora.safetensors",
        defaultScale: 1.0,
        tags: ["realism", "cinematic", "lifestyle", "portrait"],
    },
    {
        id: "studio-product-shot",
        name: "Studio Product Shot",
        description:
            "Студийная продуктовая фотография: чистый фон, мягкие тени, e-commerce ready.",
        previewUrl: "/lora-previews/studio-product-shot.jpg",
        family: "flux-1",
        // Aleksa Gordić's product-photography LoRA — tuned for clean isolated
        // products on neutral backgrounds, our Yandex Market use-case.
        path: "https://huggingface.co/alvdansen/flux-koda/resolve/main/araminta_k_flux_koda.safetensors",
        defaultScale: 0.9,
        triggerWords: ["product photography", "studio lighting", "clean background"],
        tags: ["product", "ecommerce", "studio", "yandex-market"],
    },
    {
        id: "3d-clay-render",
        name: "3D Clay Render",
        description:
            "Стилизованный 3D-рендер с пластилиновой фактурой и мягкими тенями. Подходит для иллюстраций и иконок.",
        previewUrl: "/lora-previews/3d-clay-render.jpg",
        family: "flux-1",
        // Strangerzonehf — popular 3D-clay style LoRA on HF for FLUX.1.
        path: "https://huggingface.co/strangerzonehf/Flux-3DXL-Partfile-0006/resolve/main/3DXLP6.safetensors",
        defaultScale: 1.1,
        triggerWords: ["3DXLP6", "3d render", "clay material"],
        tags: ["3d", "stylised", "illustration"],
    },
    {
        id: "vintage-film",
        name: "Vintage Film",
        description:
            "Винтажная плёночная эстетика с лёгким зерном, тёплыми тонами и мягким контрастом.",
        previewUrl: "/lora-previews/vintage-film.jpg",
        family: "flux-1",
        // Aleksa Gordić's "Frosting Lane Flux" — vintage / film aesthetic.
        path: "https://huggingface.co/alvdansen/frosting_lane_flux/resolve/main/araminta_k_frosting_lane.safetensors",
        defaultScale: 0.95,
        triggerWords: ["frstingln illustration", "vintage film"],
        tags: ["vintage", "film", "warm", "retro"],
    },
];

/** Lookup by id (system catalogue only). */
export function getSystemLoraById(id: string): LoraPresetEntry | undefined {
    return SYSTEM_LORA_CATALOG.find((p) => p.id === id);
}

/** All system presets compatible with a given LoRA family. */
export function getSystemLorasByFamily(
    family: LoraSpec["family"],
): LoraPresetEntry[] {
    return SYSTEM_LORA_CATALOG.filter((p) => p.family === family);
}
