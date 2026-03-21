/**
 * useProjectVersions Hook
 *
 * Frontend hooks for project version management:
 * - List versions for a project
 * - Create new version snapshot
 * - Restore a previous version
 */

"use client";

import { useCallback } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Hook to list all versions of a project.
 */
export function useProjectVersions(projectId: string | null) {
  const versionsQuery = trpc.project.listVersions.useQuery(
    { projectId: projectId! },
    {
      enabled: !!projectId,
      retry: false, // Don't retry if project not in DB
      refetchOnWindowFocus: false,
    }
  );

  return {
    versions: versionsQuery.data ?? [],
    isLoading: versionsQuery.isLoading,
    isError: versionsQuery.isError,
    refetch: versionsQuery.refetch,
  };
}

/**
 * Hook to create a version snapshot of the current project state.
 */
export function useCreateVersion() {
  const createMutation = trpc.project.createVersion.useMutation();

  const createVersion = useCallback(
    async (projectId: string, label?: string): Promise<{ version: unknown; error: string | null }> => {
      try {
        const version = await createMutation.mutateAsync({
          projectId,
          label,
        });
        return { version, error: null };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        // Map known errors to user-friendly messages
        if (message.includes("No canvas state")) {
          return { version: null, error: "Сначала внесите изменения на холсте, затем сохраните версию" };
        }
        if (message.includes("NOT_FOUND") || message.includes("Foreign key")) {
          return { version: null, error: "Проект ещё не сохранён на сервере. Внесите изменения и подождите авто-сохранение" };
        }
        return { version: null, error: `Ошибка: ${message}` };
      }
    },
    [createMutation]
  );

  return {
    createVersion,
    isPending: createMutation.isPending,
  };
}

/**
 * Hook to restore a previous version.
 * After restoring, the canvasState in the DB is overwritten with the version's state.
 * The frontend should reload the canvas after calling this.
 */
export function useRestoreVersion() {
  const restoreMutation = trpc.project.restoreVersion.useMutation();

  const restoreVersion = useCallback(
    async (projectId: string, versionId: string) => {
      try {
        await restoreMutation.mutateAsync({ projectId, versionId });
        return true;
      } catch (err) {
        console.error("Failed to restore version:", err);
        return false;
      }
    },
    [restoreMutation]
  );

  return {
    restoreVersion,
    isPending: restoreMutation.isPending,
  };
}
