"use client";

/**
 * useCreateBannerFromAsset
 *
 * Creates a new banner project and navigates to the editor with the given
 * image pre-loaded as a canvas layer (and optionally opens the template picker
 * so the user can drop the image onto a template).
 *
 * Used by the photo workspace (result cards, library panel) and the dashboard
 * assets tab — anywhere a user wants to "turn this image into a banner".
 *
 * The EditorPage handles the query params `?assetId=` / `?imageUrl=` and
 * `?openTemplates=1`; see `src/app/editor/[id]/page.tsx`.
 */

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";

export interface CreateBannerOptions {
    /** Preferred — reference an existing Asset by id. The editor will resolve its url. */
    assetId?: string;
    /** Fallback — raw image url (for images that are not persisted as assets yet). */
    imageUrl?: string;
    /**
     * Deprecated — opens the template picker in the empty new editor. Prefer
     * `applyTemplate` + `applySlot` so the image lands in the right slot without
     * the user having to reload the project.
     */
    fromTemplate?: boolean;
    /**
     * Template id to apply on the fresh canvas. The editor will fetch the
     * template and run `applyTemplatePack` with a contentOverrides map.
     */
    applyTemplate?: string;
    /**
     * slotId of the image slot in the template that should receive the asset
     * (via contentOverrides). Required when `applyTemplate` is set and you
     * want the image to actually land on a specific layer.
     */
    applySlot?: string;
    /** Custom project name; defaults to "Новый баннер". */
    name?: string;
}

export function useCreateBannerFromAsset() {
    const router = useRouter();
    const { currentWorkspace } = useWorkspace();
    const createProject = trpc.project.create.useMutation();

    const createAndOpen = useCallback(
        async (opts: CreateBannerOptions) => {
            const workspaceId = currentWorkspace?.id;
            if (!workspaceId) {
                throw new Error("Воркспейс не выбран");
            }
            if (!opts.assetId && !opts.imageUrl) {
                throw new Error("Нужен assetId или imageUrl");
            }

            const project = await createProject.mutateAsync({
                name: opts.name?.trim() || "Новый баннер",
                workspaceId,
                goal: "banner",
            });

            const params = new URLSearchParams();
            if (opts.assetId) params.set("assetId", opts.assetId);
            else if (opts.imageUrl) params.set("imageUrl", opts.imageUrl);
            // Precise: apply a template and drop the image into a specific slot.
            if (opts.applyTemplate) {
                params.set("applyTemplate", opts.applyTemplate);
                if (opts.applySlot) params.set("applySlot", opts.applySlot);
            } else if (opts.fromTemplate) {
                // Legacy: just open the template picker on an empty editor.
                params.set("openTemplates", "1");
            }

            router.push(`/editor/${project.id}?${params.toString()}`);
            return project;
        },
        [createProject, currentWorkspace, router],
    );

    return {
        createAndOpen,
        isCreating: createProject.isPending,
    };
}
