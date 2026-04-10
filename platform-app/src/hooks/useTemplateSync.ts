/**
 * useTemplateSync Hook
 *
 * Syncs template data between Zustand (localStorage) and backend (tRPC/Prisma).
 * Handles:
 * - Loading template list from backend
 * - Saving new templates to backend when created locally
 * - Merging backend + local templates for display
 */

"use client";

import { useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useTemplateStore } from "@/store/templateStore";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type { TemplatePackV2 } from "@/services/templateService";

// Cache workspace ID from project sync
import { cachedWorkspaceId } from "@/hooks/useProjectSync";

/**
 * Hook to load templates from backend and merge with local ones.
 * Use on the templates listing page.
 */
export function useTemplateListSync() {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id ?? cachedWorkspaceId ?? null;

  const templatesQuery = trpc.template.list.useQuery(
    { workspaceId: workspaceId! },
    {
      enabled: !!workspaceId,
      retry: 1,
      refetchOnWindowFocus: false,
    }
  );

  // Merge backend templates into local store format
  type BackendTemplate = {
    id: string;
    name: string;
    description: string;
    version: string;
    categories: string[];
    contentType: string;
    occasion: string;
    tags: unknown;
    isOfficial: boolean;
    visibility: string;
    thumbnailUrl: string | null;
    popularity: number;
    createdAt: Date;
    updatedAt: Date;
    author: string;
    resizes: any[]; // Include resizes mapped from template.list
  };

  const backendTemplates: TemplatePackV2[] = (
    (templatesQuery.data ?? []) as BackendTemplate[]
  ).map((t: BackendTemplate) => ({
    // These will be populated when the full template is loaded
    id: t.id,
    version: t.version,
    name: t.name,
    description: t.description,
    baseWidth: 0,
    baseHeight: 0,
    masterComponents: [],
    componentInstances: [],
    resizes: t.resizes || [],

    // V2 metadata
    businessUnits: ["other" as const],
    categories: (t.categories || []) as TemplatePackV2["categories"],
    contentType: (t.contentType || "visual") as TemplatePackV2["contentType"],
    occasion: (t.occasion || "default") as TemplatePackV2["occasion"],
    tags: (Array.isArray(t.tags) ? t.tags : []) as TemplatePackV2["tags"],
    author: t.author,
    isOfficial: t.isOfficial,
    visibility: (t.visibility || "WORKSPACE") as TemplatePackV2["visibility"],
    thumbnailUrl: t.thumbnailUrl ?? undefined,
    popularity: t.popularity,
    createdAt: new Date(t.createdAt).toISOString(),
    updatedAt: new Date(t.updatedAt).toISOString(),
  }));

  return {
    workspaceId,
    backendTemplates,
    isLoading: !workspaceId || templatesQuery.isLoading,
    isError: templatesQuery.isError,
    refetch: templatesQuery.refetch,
  };
}

/**
 * Hook for saving a template pack to the backend.
 */
export function useSaveTemplateSync() {
  const createMutation = trpc.template.create.useMutation();

  const saveTemplate = useCallback(
    async (pack: TemplatePackV2, workspaceId?: string) => {
      const wsId = workspaceId ?? cachedWorkspaceId;
      if (!wsId) {
        console.error("No workspace ID available for template save");
        return null;
      }

      try {
        // Merge businessUnits into categories so they're searchable in Prisma
        const mergedCategories = [
          ...new Set([
            ...((pack.categories || []) as string[]),
            ...((pack.businessUnits || []) as string[]),
          ]),
        ];

        const template = await createMutation.mutateAsync({
          workspaceId: wsId,
          name: pack.name,
          description: pack.description,
          categories: mergedCategories,
          contentType: pack.contentType,
          occasion: pack.occasion,
          tags: pack.tags,
          data: pack, // Store the entire pack as JSON
          isOfficial: pack.isOfficial,
          visibility: (pack.visibility || "WORKSPACE") as "PRIVATE" | "WORKSPACE" | "PUBLIC" | "SHARED",
          thumbnailUrl: pack.thumbnailUrl,
        });
        return template;
      } catch (err) {
        console.error("Failed to save template to backend:", err);
        return null;
      }
    },
    [createMutation]
  );

  return {
    saveTemplate,
    isPending: createMutation.isPending,
  };
}

/**
 * Hook to load full template data by ID.
 * Use when applying a backend template.
 */
export function useLoadTemplate(templateId: string | null) {
  const templateQuery = trpc.template.getById.useQuery(
    { id: templateId! },
    {
      enabled: !!templateId,
      retry: 1,
      refetchOnWindowFocus: false,
    }
  );

  return {
    template: templateQuery.data,
    isLoading: templateQuery.isLoading,
    isError: templateQuery.isError,
  };
}

/**
 * Auto-sync: push local-only templates to backend on mount.
 * Call this once on the templates page to ensure local packs
 * are backed up to the DB.
 */
export function useTemplatePushSync() {
  const savedPacks = useTemplateStore((s) => s.savedPacks);
  const { saveTemplate } = useSaveTemplateSync();
  const { backendTemplates } = useTemplateListSync();

  useEffect(() => {
    if (backendTemplates.length === 0 && savedPacks.length === 0) return;

    // Find local packs not in backend
    const backendIds = new Set(backendTemplates.map((t) => t.id));
    const localOnly = savedPacks.filter((p) => !backendIds.has(p.id));

    // Push each local-only template to backend (non-blocking)
    for (const pack of localOnly) {
      saveTemplate(pack).catch(() => {
        // Silent — will retry next mount
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendTemplates.length, savedPacks.length]);
}
