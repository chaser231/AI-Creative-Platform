/**
 * PhotoInpaintModal — Photo workspace wrapper around the shared
 * InpaintImageModal. Adds chat + asset side-effects:
 *   • Persists the result to S3.
 *   • Saves a project asset so it shows up in the library.
 *   • Appends an assistant chat message tied to the active session so the
 *     result appears inline in the chat view.
 *   • Drops the edit context on success so the prompt bar returns to the
 *     idle state.
 */

"use client";

import { trpc } from "@/lib/trpc";
import { usePhotoStore } from "@/store/photoStore";
import { InpaintImageModal, type InpaintApplyMeta } from "@/components/inpaint/InpaintImageModal";
import { persistImageToS3 } from "@/utils/imageUpload";
import { getModelById } from "@/lib/ai-models";

interface PhotoInpaintModalProps {
    projectId: string;
}

export function PhotoInpaintModal({ projectId }: PhotoInpaintModalProps) {
    const inpaintMode = usePhotoStore((s) => s.inpaintMode);
    const setInpaintMode = usePhotoStore((s) => s.setInpaintMode);
    const editContext = usePhotoStore((s) => s.editContext);
    const clearEditContext = usePhotoStore((s) => s.clearEditContext);
    const activeSessionId = usePhotoStore((s) => s.activeSessionId);

    const utils = trpc.useUtils();
    const addMessageMutation = trpc.ai.addMessage.useMutation();
    const saveGeneratedAssetMutation = trpc.asset.saveGeneratedImage.useMutation();

    const open = inpaintMode && !!editContext;

    const handleApply = async (rawUrl: string, meta: InpaintApplyMeta): Promise<string> => {
        let persisted = rawUrl;
        if (!persisted.includes("storage.yandexcloud.net")) {
            persisted = await persistImageToS3(persisted, projectId);
        }
        try {
            await saveGeneratedAssetMutation.mutateAsync({
                projectId,
                url: persisted,
                prompt: meta.intent === "remove" ? "Удалить (inpaint)" : meta.prompt,
                model: meta.model,
                source: meta.intent === "remove" ? "photo-inpaint-remove" : "photo-inpaint",
            });
        } catch (e) {
            console.warn("[PhotoInpaintModal] asset save failed", e);
        }
        if (activeSessionId && editContext) {
            try {
                await addMessageMutation.mutateAsync({
                    sessionId: activeSessionId,
                    role: "assistant",
                    content: persisted,
                    type: "image",
                    model: meta.model,
                    costUnits: getModelById(meta.model)?.costPerRun ?? 0,
                    metadata: {
                        kind: "edit",
                        sourceUrl: editContext.url,
                    },
                });
                await utils.ai.getMessages.invalidate({ sessionId: activeSessionId });
            } catch (e) {
                console.warn("[PhotoInpaintModal] message append failed", e);
            }
        }
        await Promise.all([
            utils.asset.listByProject.invalidate({ projectId }),
            utils.project.list.invalidate(),
        ]);
        clearEditContext();
        return persisted;
    };

    if (!editContext) return null;

    return (
        <InpaintImageModal
            open={open}
            sourceUrl={editContext.url}
            projectId={projectId}
            onApply={handleApply}
            onClose={() => setInpaintMode(false)}
        />
    );
}
