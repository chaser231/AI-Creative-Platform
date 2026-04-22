"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Wand2, X, Ratio, Settings2, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePhotoStore } from "@/store/photoStore";
import { RefAutocompleteTextarea } from "@/components/ui/RefAutocompleteTextarea";
import { getModelById, getMaxRefs, getAspectRatios, getResolutions, resolveRefTags } from "@/lib/ai-models";
import { persistImageToS3, uploadForAI, uploadManyForAI } from "@/utils/imageUpload";
import { ImageStylePresetPicker } from "@/components/ui/StylePresetPicker";
import { useStylePresets } from "@/hooks/useStylePresets";
import { getImagePresetPromptSuffix } from "@/lib/stylePresets";
import { ReferenceImageInput } from "@/components/ui/ReferenceImageInput";
import { useProjectLibrary } from "@/hooks/useProjectLibrary";

interface PhotoPromptBarProps {
    projectId: string;
}

// Full-generation image models (text → image)
const IMAGE_MODELS = [
    { id: "nano-banana-2", name: "Nano Banana 2" },
    { id: "nano-banana-pro", name: "Nano Banana Pro" },
    { id: "nano-banana", name: "Nano Banana" },
    { id: "flux-2-pro", name: "Flux 2 Pro" },
    { id: "seedream", name: "Seedream 4.5" },
    { id: "gpt-image", name: "GPT Image 1.5" },
    { id: "qwen-image", name: "Qwen Image" },
    { id: "flux-schnell", name: "Flux Schnell" },
    { id: "flux-dev", name: "Flux Dev" },
    { id: "flux-1.1-pro", name: "Flux 1.1 Pro" },
    { id: "dall-e-3", name: "DALL-E 3" },
];

// Models that can edit an existing image (text-guided, full-image, no mask)
const EDIT_MODELS = [
    { id: "nano-banana-2", name: "Nano Banana 2" },
    { id: "nano-banana-pro", name: "Nano Banana Pro" },
    { id: "nano-banana", name: "Nano Banana" },
    { id: "flux-2-pro", name: "Flux 2 Pro" },
    { id: "seedream", name: "Seedream 4.5" },
    { id: "gpt-image", name: "GPT Image 1.5" },
    { id: "qwen-image-edit", name: "Qwen Image Edit" },
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

    const { imagePresets } = useStylePresets();

    const [prompt, setPrompt] = useState("");
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [scale, setScale] = useState("");
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

    const handleModelChange = (id: string) => {
        if (isEditMode) setEditModel(id);
        else setSelectedModel(id);
        const ratios = getAspectRatios(id);
        if (!ratios.includes(aspectRatio)) setAspectRatio(ratios[0] || "1:1");
        const res = getResolutions(id);
        setScale(res.length > 0 ? res[0].id : "");
        if (!(getModelById(id)?.caps.includes("vision") ?? false)) {
            setReferenceImages([]);
        }
    };

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

        try {
            const resolvedPromptBase = resolveRefTags(prompt, activeModelId);
            // Apply selected style preset as a suffix (same contract as AIPromptBar)
            const styleSuffix = getImagePresetPromptSuffix(imageStyleId, imagePresets);
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

            let rawResultUrl: string;
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
                    }),
                });
                const data = await response.json();
                if (data.error || !data.content) {
                    throw new Error(data.error || "Пустой ответ от модели");
                }
                rawResultUrl = data.content;
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
                        referenceImages: refsForCall,
                        projectId,
                        // Photo workspace writes the final AIMessage itself (with the
                        // persisted S3 URL). Skip server-side tracking to avoid duplicates.
                        recordMessage: false,
                    }),
                });
                const data = await response.json();
                if (data.error || !data.content) {
                    throw new Error(data.error || "Пустой ответ от модели");
                }
                rawResultUrl = data.content;
                responseModel = data.model;
            }

            // Persist generated image to our S3 bucket so the URL doesn't expire.
            // If persistence fails we must NOT write the volatile URL into the
            // library/chat — it will 404 within minutes and leave "ghost" assets
            // like `photo-generation-…png` with no preview.
            let persisted: string | null = null;
            try {
                const result = await persistImageToS3(rawResultUrl, projectId);
                if (result && result.includes("storage.yandexcloud.net")) {
                    persisted = result;
                }
            } catch (persistErr) {
                console.error("Photo S3 persist failed:", persistErr);
            }

            if (!persisted) {
                throw new Error(
                    "Не удалось сохранить сгенерированное изображение. Повторите попытку."
                );
            }

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

            // Record the assistant message (server-side tracking is disabled via
            // recordMessage:false, so we log cost units here)
            const costUnits = getModelById(responseModel ?? activeModelId)?.costPerRun ?? 0;
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

            // Refresh related queries so chat/library/dashboard reflect the new image
            await Promise.all([
                utils.ai.getMessages.invalidate({ sessionId }),
                utils.ai.listSessions.invalidate({ projectId }),
                utils.asset.listByProject.invalidate({ projectId }),
                // Dashboard thumbnails for photo projects are derived from the
                // latest asset server-side — invalidate so the grid picks it up.
                utils.project.list.invalidate(),
            ]);

            setPrompt("");
            setReferenceImages([]);
            if (isEditMode) clearEditContext();
        } catch (e) {
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
        <div className="flex flex-col items-center gap-2 w-[min(760px,95vw)]">
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

            <div className="relative flex flex-col w-full bg-bg-surface/95 backdrop-blur-xl border border-border-primary rounded-[20px] shadow-2xl">
                {/* Prompt area */}
                <div className="flex-1 px-4 pt-3 pb-2 min-h-[72px]">
                    <RefAutocompleteTextarea
                        ref={textareaRef as any}
                        value={prompt}
                        onChange={setPrompt}
                        referenceImages={referenceImages}
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

                {/* Bottom bar */}
                <div className="px-3 pb-3 pt-1 flex items-center gap-2 flex-wrap">
                    {/* Model */}
                    <Selector icon={<Settings2 size={12} />}>
                        <select
                            value={activeModelId}
                            onChange={(e) => handleModelChange(e.target.value)}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        >
                            {currentModels.map((m) => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                        </select>
                        <span className="text-text-secondary font-medium pointer-events-none">
                            {currentModels.find(m => m.id === activeModelId)?.name}
                        </span>
                    </Selector>

                    {/* Aspect ratio (generate mode only) */}
                    {!isEditMode && (
                        <Selector icon={<Ratio size={12} />}>
                            <select
                                value={aspectRatio}
                                onChange={(e) => setAspectRatio(e.target.value)}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            >
                                {modelAspectRatios.map((r) => (
                                    <option key={r} value={r}>{r}</option>
                                ))}
                            </select>
                            <span className="text-text-secondary font-medium pointer-events-none">
                                {aspectRatio}
                            </span>
                        </Selector>
                    )}

                    {/* Resolution */}
                    {!isEditMode && modelResolutions.length > 0 && (
                        <Selector>
                            <select
                                value={scale}
                                onChange={(e) => setScale(e.target.value)}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            >
                                {modelResolutions.map((r) => (
                                    <option key={r.id} value={r.id}>{r.label}</option>
                                ))}
                            </select>
                            <span className="text-text-secondary font-medium pointer-events-none">
                                {modelResolutions.find(r => r.id === scale)?.label || scale}
                            </span>
                        </Selector>
                    )}

                    {/* Style preset — applied as suffix to the prompt. Available in both
                        generate and edit modes so the user can nudge edits toward a style. */}
                    <ImageStylePresetPicker
                        presets={imagePresets}
                        selectedId={imageStyleId}
                        onChange={setImageStyleId}
                        variant="compact"
                    />

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
        </div>
    );
}

function Selector({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] border border-border-primary/60 text-[12px] text-text-secondary hover:border-border-secondary hover:bg-bg-tertiary/30 transition-all focus-within:border-border-secondary focus-within:bg-bg-tertiary/30">
            {icon && <span className="text-text-tertiary flex-shrink-0 pointer-events-none">{icon}</span>}
            {children}
        </div>
    );
}
