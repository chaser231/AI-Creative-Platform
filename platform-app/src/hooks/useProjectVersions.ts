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
      retry: 1,
      refetchOnWindowFocus: false,
    }
  );

  return {
    versions: versionsQuery.data ?? [],
    isLoading: versionsQuery.isLoading,
    refetch: versionsQuery.refetch,
  };
}

/**
 * Hook to create a version snapshot of the current project state.
 */
export function useCreateVersion() {
  const createMutation = trpc.project.createVersion.useMutation();

  const createVersion = useCallback(
    async (projectId: string, label?: string) => {
      try {
        const version = await createMutation.mutateAsync({
          projectId,
          label,
        });
        return version;
      } catch (err) {
        console.error("Failed to create version:", err);
        return null;
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
