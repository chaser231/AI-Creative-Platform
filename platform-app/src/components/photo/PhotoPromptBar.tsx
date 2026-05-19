"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Wand2, X, Ratio, Settings2, Loader2, Maximize2, Sliders } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePhotoStore } from "@/store/photoStore";
import { RefAutocompleteTextarea } from "@/components/ui/RefAutocompleteTextarea";
import { getModelById, getMaxRefs, getMaxOutputs, getAspectRatios, getResolutions, getDefaultResolution, resolveRefTags, getLoraSpec } from "@/lib/ai-models";
import type { LoraWeight } from "@/lib/ai-providers";
import { persistImageToS3, uploadForAI, uploadManyForAI } from "@/utils/imageUpload";
import { ImageStylePresetPicker } from "@/components/ui/StylePresetPicker";
import { LoraSelectorPicker } from "@/components/ui/LoraSelectorPicker";
import { LoraTriggerHint } from "@/components/ui/LoraTriggerHint";
import { ModelSettingsModal, type AdvancedAIParams } from "@/components/ui/ModelSettingsModal";
import { useStylePresets } from "@/hooks/useStylePresets";
import { getImagePresetPromptSuffixForModel } from "@/lib/stylePresets";
import { ReferenceImageInput, ReferenceImagePreviewTray, getReferenceTrayReserveWidth } from "@/components/ui/ReferenceImageInput";
import { useProjectLibrary } from "@/hooks/useProjectLibrary";
import { SelectPill } from "@/components/ui/SelectPill";

interface PhotoPromptBarProps {
    projectId: string;
}

// Full-generation image models (text → image)
const IMAGE_MODELS = [
    { id: "nano-banana-2", name: "Nano Banana 2" },
    { id: "nano-banana-pro", name: "Nano Banana Pro" },
    { id: "nano-banana", name: "Nano Banana" },
    { id: "flux-2-pro", name: "Flux 2 Pro" },
    { id: "seedream-5", name: "Seedream 5" },
    { id: "seedream", name: "Seedream 4.5" },
    { id: "gpt-image-2", name: "GPT Image 2" },
    { id: "gpt-image", name: "GPT Image 1.5" },
    { id: "qwen-image", name: "Qwen Image" },
    { id: "flux-schnell", name: "Flux Schnell" },
    { id: "flux-dev", name: "Flux Dev" },
    { id: "flux-1.1-pro", name: "Flux 1.1 Pro" },
    { id: "dall-e-3", name: "DALL-E 3" },
    { id: "flux-lora", name: "FLUX.1 LoRA" },
    { id: "flux-2-lora", name: "FLUX.2 LoRA" },
    { id: "qwen-image-lora", name: "Qwen Image LoRA" },
];

// Models that can edit an existing image (text-guided, full-image, no mask)
const EDIT_MODELS = [
    { id: "nano-banana-2", name: "Nano Banana 2" },
    { id: "nano-banana-pro", name: "Nano Banana Pro" },
    { id: "nano-banana", name: "Nano Banana" },
    { id: "flux-2-pro", name: "Flux 2 Pro" },
    { id: "seedream-5", name: "Seedream 5" },
    { id: "seedream", name: "Seedream 4.5" },
    { id: "gpt-image-2", name: "GPT Image 2" },
    { id: "gpt-image", name: "GPT Image 1.5" },
    { id: "qwen-image-edit", name: "Qwen Image Edit" },
    { id: "qwen-image-edit-lora", name: "Qwen Image Edit LoRA" },
];

export function PhotoPromptBar({ projectId }: PhotoPromptBarProps) {
    const activeSessionId = usePhotoStore((s) => s.activeSessionId);
    const editContext = usePhotoStore((s) => s.editContext);
    const clearEditContext = usePhotoStore((s) => s.clearEditContext);
    const selectedModelId = usePhotoStore((s) => s.selectedModelId);
    const setSelectedModel = usePhotoStore((s) => s.setSelectedModel);
    const editModelId = usePhotoStore((s) => s.editModelId);
    const setEditModel = usePhotoStore((s) => s.setEditModel);
    const aspectRatio = usePhotoStore((s) => s.aspectRatio);
    const setAspectRatio = usePhotoStore((s) => s.setAspectRatio);
    const imageStyleId = usePhotoStore((s) => s.imageStyleId);
    const setImageStyleId = usePhotoStore((s) => s.setImageStyleId);
    const addPendingGeneration = usePhotoStore((s) => s.addPendingGeneration);
    const clearPendingGeneration = usePhotoStore((s) => s.clearPendingGeneration);

    const { imagePresets } = useStylePresets();

    const [prompt, setPrompt] = useState("");
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [imageCount, setImageCount] = useState(1);
    // LoRA selection + advanced overrides — local because they're scoped to
    // the active model and shouldn't leak into other photo sessions.
    const [loras, setLoras] = useState<LoraWeight[]>([]);
    const [advancedParams, setAdvancedParams] = useState<AdvancedAIParams>({});
    const [settingsOpen, setSettingsOpen] = useState(false);
    // Initialize with the first resolution of the default model so the
    // selector never renders as an empty pill.
    const [scale, setScale] = useState(() => getDefaultResolution(selectedModelId));
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Consume pending references pushed from result cards / library "Use as reference".
    const pendingReferences = usePhotoStore((s) => s.pendingReferences);
    const clearPendingReferences = usePhotoStore((s) => s.clearPendingReferences);
    useEffect(() => {
        if (pendingReferences.length === 0) return;
        setReferenceImages((prev) => {
            const seen = new Set(prev);
            const next = [...prev];
            for (const url of pendingReferences) {
                if (!seen.has(url)) {
                    next.push(url);
                    seen.add(url);
                }
            }
            return next;
        });
        clearPendingReferences();
    }, [pendingReferences, clearPendingReferences]);

    const utils = trpc.useUtils();
    const addMessageMutation = trpc.ai.addMessage.useMutation();
    const saveGeneratedAssetMutation = trpc.asset.saveGeneratedImage.useMutation();
    const createSessionMutation = trpc.ai.createSession.useMutation();
    const { registerFile } = useProjectLibrary();

    const isEditMode = !!editContext;
    const activeModelId = isEditMode ? editModelId : selectedModelId;
    const currentModels = isEditMode ? EDIT_MODELS : IMAGE_MODELS;

    const supportsVision = useMemo(
        () => getModelById(activeModelId)?.caps.includes("vision") ?? false,
        [activeModelId]
    );
    const modelAspectRatios = useMemo(() => getAspectRatios(activeModelId), [activeModelId]);
    const modelResolutions = useMemo(() => getResolutions(activeModelId), [activeModelId]);
    const maxImageOutputs = isEditMode ? 1 : getMaxOutputs(activeModelId);

    // Keep `scale` in sync with the model's available resolutions. If the
    // current value isn't valid for the active model (e.g. after switching to
    // edit mode, or after the store was hydrated with a stale value), reset
    // to the first option so the selector always shows a real label.
    useEffect(() => {
        if (modelResolutions.length === 0) {
            if (scale !== "") setScale("");
            return;
        }
        const isValid = modelResolutions.some((r) => r.id === scale);
        if (!isValid) setScale(getDefaultResolution(activeModelId));
    }, [modelResolutions, scale]);

    const handleModelChange = (id: string) => {
        if (isEditMode) setEditModel(id);
        else setSelectedModel(id);
        const ratios = getAspectRatios(id);
        if (!ratios.includes(aspectRatio)) setAspectRatio(ratios[0] || "1:1");
        const res = getResolutions(id);
        setScale(getDefaultResolution(id));
        setImageCount(1);
        if (!(getModelById(id)?.caps.includes("vision") ?? false)) {
            setReferenceImages([]);
        }
        // Drop LoRA selections + advanced overrides on every swap — they
        // belong to the previous model's loraSpec and would either be
        // ignored (cheap) or rejected (worse, after billing).
        setLoras([]);
        setAdvancedParams({});
    };

    useEffect(() => {
        if (imageCount > maxImageOutputs) setImageCount(maxImageOutputs);
    }, [imageCount, maxImageOutputs]);

    // LoRA capabilities — drives picker / settings visibility.
    const loraSpec = getLoraSpec(activeModelId);
    const loraRequestFields = loraSpec
        ? {
            loras: loras.length > 0 ? loras : undefined,
            guidanceScale: advancedParams.guidanceScale,
            numInferenceSteps: advancedParams.numInferenceSteps,
            negativePrompt: advancedParams.negativePrompt,
            acceleration: advancedParams.acceleration,
        }
        : {};

    const ensureSession = async (): Promise<string | null> => {
        if (activeSessionId) return activeSessionId;
        try {
            const created = await createSessionMutation.mutateAsync({ projectId });
            usePhotoStore.getState().setActiveSession(created.id);
            await utils.ai.listSessions.invalidate({ projectId });
            return created.id;
        } catch {
            return null;
        }
    };

    const parseAiError = (e: Error) => {
        const msg = String(e.message || "");
        if (msg.includes("E003") || msg.includes("high demand") || msg.includes("fetch failed")) {
            return "Слишком много запросов. Подождите 10–15 секунд и попробуйте снова.";
        }
        if (msg.includes("timed out")) {
            return "Генерация заняла слишком много времени.";
        }
        if (msg.includes("429")) {
            return "Rate limit. Попробуйте через 10 секунд.";
        }
        return msg || "Ошибка генерации";
    };

    const handleSubmit = async () => {
        if (isGenerating) return;
        if (!prompt.trim() && !isEditMode) return;

        setErrorMsg(null);
        setIsGenerating(true);

        const sessionId = await ensureSession();
        if (!sessionId) {
            setErrorMsg("Не удалось создать сессию");
            setIsGenerating(false);
            return;
        }

        let pendingId: string | null = null;
        try {
            const resolvedPromptBase = resolveRefTags(prompt, activeModelId);
            // Apply selected style preset as a suffix (same contract as AIPromptBar)
            const styleSuffix = getImagePresetPromptSuffixForModel(imageStyleId, activeModelId, imagePresets);
            const resolvedPrompt = styleSuffix
                ? `${resolvedPromptBase}. Style: ${styleSuffix}`
                : resolvedPromptBase;
            const refsForCall = referenceImages.length > 0 ? referenceImages : undefined;

            // Log user message first (optimistic; assistant will follow after API call)
            await addMessageMutation.mutateAsync({
                sessionId,
                role: "user",
                content: prompt,
                type: "text",
                metadata: {
                    kind: isEditMode ? "edit" : "generate",
                    model: activeModelId,
                    aspectRatio: isEditMode ? undefined : aspectRatio,
                    referenceImages: refsForCall,
                    sourceUrl: isEditMode ? editContext?.url : undefined,
                },
            });

            const requestedCount = isEditMode ? 1 : Math.min(imageCount, maxImageOutputs);
            pendingId = `pending-${Date.now()}`;
            if (!isEditMode) {
                addPendingGeneration({
                    id: pendingId,
                    sessionId,
                    count: requestedCount,
                    aspectRatio,
                    prompt,
                });
            }

            let rawResultUrls: string[];
            let responseModel: string | undefined;

            if (isEditMode && editContext) {
                // Pre-upload images to S3 to avoid sending multi-MB base64 through the server
                const [imageUrl, refUrls] = await Promise.all([
                    uploadForAI(editContext.url, projectId),
                    refsForCall ? uploadManyForAI(refsForCall, projectId) : Promise.resolve(undefined),
                ]);

                const response = await fetch("/api/ai/image-edit", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "text-edit",
                        prompt: resolvedPrompt,
                        imageBase64: imageUrl,
                        model: activeModelId,
                        referenceImages: refUrls,
                        projectId,
                        // Photo workspace writes the final AIMessage itself (with the
                        // persisted S3 URL). Skip server-side tracking to avoid duplicates.
                        recordMessage: false,
                        ...loraRequestFields,
                    }),
                });
                const data = await response.json();
                if (data.error || !data.content) {
                    throw new Error(data.error || "Пустой ответ от модели");
                }
                rawResultUrls = [data.content];
                responseModel = data.model;
            } else {
                const response = await fetch("/api/ai/generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        prompt: resolvedPrompt,
                        type: "image",
                        model: activeModelId,
                        aspectRatio,
                        scale: scale || undefined,
                        count: requestedCount,
                        referenceImages: refsForCall,
                        projectId,
                        // Photo workspace writes the final AIMessage itself (with the
                        // persisted S3 URL). Skip server-side tracking to avoid duplicates.
                        recordMessage: false,
                        ...loraRequestFields,
                    }),
                });
                const data = await response.json();
                if (data.error || !data.content) {
                    throw new Error(data.error || "Пустой ответ от модели");
                }
                rawResultUrls = Array.from(new Set(((Array.isArray(data.contents) && data.contents.length > 0) ? data.contents : [data.content])
                    .filter((url: unknown): url is string => typeof url === "string" && url.length > 0)));
                responseModel = data.model;
            }

            // Persist generated image to our S3 bucket so the URL doesn't expire.
            // If persistence fails we must NOT write the volatile URL into the
            // library/chat — it will 404 within minutes and leave "ghost" assets
            // like `photo-generation-…png` with no preview.
            const persistedUrls: string[] = [];
            for (let i = 0; i < rawResultUrls.length; i++) {
                if (i > 0) {
                    await new Promise((resolve) => setTimeout(resolve, 150));
                }
                let persisted: string | null = null;
                try {
                    let result = await persistImageToS3(rawResultUrls[i], projectId);
                    if (!result.includes("storage.yandexcloud.net")) {
                        await new Promise((resolve) => setTimeout(resolve, 200));
                        result = await persistImageToS3(rawResultUrls[i], projectId);
                    }
                    if (result && result.includes("storage.yandexcloud.net")) {
                        persisted = result;
                    }
                } catch (persistErr) {
                    console.error(`Photo S3 persist failed index=${i}:`, persistErr);
                }

                if (!persisted) {
                    continue;
                }

                persistedUrls.push(persisted);

                // Save as a workspace asset tagged with source=photo-generation
                try {
                    await saveGeneratedAssetMutation.mutateAsync({
                        projectId,
                        url: persisted,
                        prompt,
                        model: responseModel ?? activeModelId,
                        source: "photo-generation",
                    });
                } catch (saveErr) {
                    console.error("Asset save failed:", saveErr);
                }
            }

            if (persistedUrls.length === 0) {
                throw new Error(
                    "Не удалось сохранить сгенерированное изображение. Повторите попытку.",
                );
            }

            // Record the assistant message (server-side tracking is disabled via
            // recordMessage:false, so we log cost units here)
            const costUnits = getModelById(responseModel ?? activeModelId)?.costPerRun ?? 0;
            for (const persisted of persistedUrls) {
                await addMessageMutation.mutateAsync({
                    sessionId,
                    role: "assistant",
                    content: persisted,
                    type: "image",
                    model: responseModel ?? activeModelId,
                    costUnits,
                    metadata: {
                        kind: isEditMode ? "edit" : "generate",
                        sourceUrl: isEditMode ? editContext?.url : undefined,
                    },
                });
            }

            // Refresh related queries so chat/library/dashboard reflect the new image
            await Promise.all([
                utils.ai.getMessages.invalidate({ sessionId }),
                utils.ai.listSessions.invalidate({ projectId }),
                utils.asset.listByProject.invalidate({ projectId }),
                // Dashboard thumbnails for photo projects are derived from the
                // latest asset server-side — invalidate so the grid picks it up.
                utils.project.list.invalidate(),
            ]);

            // Keep the prompt and reference images in the bar after a
            // successful generation so users can iterate on the same request
            // (tweak the wording, swap a ref, regenerate) without retyping.
            // Only the edit-context badge is dismissed, since the freshly
            // produced image is now the natural "source" for the next edit.
            if (isEditMode) clearEditContext();
            if (pendingId) clearPendingGeneration(pendingId);
        } catch (e) {
            if (pendingId) clearPendingGeneration(pendingId);
            const err = e as Error;
            console.error("Photo generation failed:", err);
            setErrorMsg(parseAiError(err));

            // Log an error message into the session so the user sees the failure in chat
            if (sessionId) {
                try {
                    await addMessageMutation.mutateAsync({
                        sessionId,
                        role: "assistant",
                        content: parseAiError(err),
                        type: "error",
                        model: activeModelId,
                    });
                    await utils.ai.getMessages.invalidate({ sessionId });
                } catch {
                    // non-blocking
                }
            }
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="flex flex-col items-center gap-2 w-[min(900px,95vw)]">
            {/* Edit badge — only shown when an image is being edited */}
            {isEditMode && editContext && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-lime/20 border border-accent-lime-hover/50 text-accent-primary text-[11px] font-medium shadow-sm">
                    <Wand2 size={12} />
                    <span>Редактируется</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={editContext.url}
                        alt="source"
                        className="w-6 h-6 rounded-[var(--radius-sm)] object-cover border border-accent-primary/30"
                    />
                    <button
                        onClick={clearEditContext}
                        className="p-0.5 rounded-full hover:bg-accent-primary/10"
                        title="Сбросить"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            <div className="relative flex flex-col w-full bg-bg-surface/95 backdrop-blur-xl border border-border-primary rounded-[20px] shadow-[var(--shadow-lg)]">
                {supportsVision && referenceImages.length > 0 && (
                    <div className="absolute right-4 top-3 z-10">
                        <ReferenceImagePreviewTray
                            images={referenceImages}
                            onChange={setReferenceImages}
                        />
                    </div>
                )}
                {/* Prompt area */}
                <div
                    className="flex-1 px-4 pt-3 pb-2 min-h-[72px]"
                    style={
                        supportsVision && referenceImages.length > 0
                            ? { paddingRight: getReferenceTrayReserveWidth(referenceImages.length) }
                            : undefined
                    }
                >
                    <RefAutocompleteTextarea
                        ref={textareaRef as any}
                        value={prompt}
                        onChange={setPrompt}
                        referenceImages={referenceImages}
                        dropdownPlacement="auto"
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSubmit();
                            }
                        }}
                        placeholder={
                            isEditMode
                                ? "Опишите изменения: добавь мягкий свет, смени фон на студийный серый..."
                                : "Опишите изображение: гиперреалистичная ваза в неоновом свете, 8k..."
                        }
                        className="w-full h-full min-h-[60px] bg-transparent text-[14px] text-text-primary placeholder:text-text-tertiary/60 focus:outline-none resize-none leading-relaxed"
                    />
                </div>

                {/* LoRA trigger hint — mirrors server-side auto-injection */}
                <div className="px-4 pb-1">
                    <LoraTriggerHint
                        family={loraSpec?.family ?? null}
                        loras={loras}
                    />
                </div>

                {/* Bottom bar */}
                <div className="flex min-w-0 items-center gap-2 overflow-x-auto px-3 pb-3 pt-1 flex-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {/* Model */}
                    <SelectPill
                        icon={<Settings2 size={12} />}
                        label="Модель"
                        value={activeModelId}
                        onChange={handleModelChange}
                        options={currentModels.map((model) => ({ value: model.id, label: model.name }))}
                        className="min-w-[150px] max-w-[190px]"
                    />

                    {/* Advanced model settings — only for LoRA-aware models. */}
                    {loraSpec && (
                        <button
                            onClick={() => setSettingsOpen(true)}
                            title="Параметры модели"
                            className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-border-primary/60 text-text-tertiary transition-all cursor-pointer hover:text-text-primary hover:bg-bg-tertiary/30"
                        >
                            <Sliders size={12} />
                        </button>
                    )}

                    {/* Aspect ratio (generate mode only) */}
                    {!isEditMode && (
                        <SelectPill
                            icon={<Ratio size={12} />}
                            label="Соотношение сторон"
                            value={aspectRatio}
                            onChange={setAspectRatio}
                            options={modelAspectRatios.map((ratio) => ({ value: ratio, label: ratio }))}
                            className="w-[86px]"
                        />
                    )}

                    {/* Resolution */}
                    {!isEditMode && modelResolutions.length > 0 && (
                        <SelectPill
                            icon={<Maximize2 size={12} />}
                            label="Разрешение"
                            value={scale}
                            onChange={setScale}
                            options={modelResolutions.map((resolution) => ({ value: resolution.id, label: resolution.label }))}
                            className="w-[82px]"
                        />
                    )}

                    {!isEditMode && maxImageOutputs > 1 && (
                        <SelectPill
                            icon={<Sparkles size={12} />}
                            label="Количество изображений"
                            value={imageCount}
                            onChange={(value) => setImageCount(Number(value))}
                            options={Array.from({ length: maxImageOutputs }, (_, index) => {
                                const count = index + 1;
                                return { value: String(count), label: String(count) };
                            })}
                            className="w-[64px]"
                        />
                    )}

                    {!loraSpec && (
                        <ImageStylePresetPicker
                            presets={imagePresets}
                            selectedId={imageStyleId}
                            onChange={setImageStyleId}
                            variant="compact"
                        />
                    )}

                    {loraSpec && (
                        <LoraSelectorPicker
                            family={loraSpec.family}
                            maxCount={loraSpec.maxCount ?? 1}
                            value={loras}
                            onChange={setLoras}
                        />
                    )}

                    <div className="flex-1" />

                    {errorMsg && (
                        <div className="text-[11px] text-red-400 truncate max-w-[280px]" title={errorMsg}>
                            {errorMsg}
                        </div>
                    )}

                    {supportsVision && (
                        <ReferenceImageInput
                            images={referenceImages}
                            onChange={setReferenceImages}
                            max={getMaxRefs(activeModelId) || 3}
                            previewMode="none"
                            onFilesAdded={(files) => {
                                for (const file of files) {
                                    void registerFile({
                                        projectId,
                                        file,
                                        source: "ai-reference",
                                    });
                                }
                            }}
                        />
                    )}

                    <button
                        onClick={handleSubmit}
                        disabled={isGenerating || (!prompt.trim() && !isEditMode)}
                        title={isEditMode ? "Применить редактирование" : "Сгенерировать"}
                        className="flex items-center justify-center w-10 h-10 rounded-full transition-all cursor-pointer bg-accent-lime-hover hover:bg-accent-lime text-accent-lime-text hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 shadow-sm"
                    >
                        {isGenerating ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : isEditMode ? (
                            <Wand2 size={18} />
                        ) : (
                            <Sparkles size={18} />
                        )}
                    </button>
                </div>
            </div>

            {/* Advanced model settings modal — only mounted for LoRA-aware models. */}
            {loraSpec && (
                <ModelSettingsModal
                    open={settingsOpen}
                    onClose={() => setSettingsOpen(false)}
                    spec={loraSpec}
                    value={advancedParams}
                    onChange={setAdvancedParams}
                />
            )}
        </div>
    );
}

