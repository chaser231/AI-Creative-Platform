/**
 * useProjectSync Hook
 *
 * Syncs project data between Zustand (in-memory) and backend (tRPC/Prisma).
 * Handles:
 * - Loading project list from backend on mount
 * - Creating projects on backend when created locally
 * - Auto-saving canvas state to backend (debounced)
 * - Loading canvas state from backend when opening editor
 *
 * Strategy: "Optimistic Local, Sync to Backend"
 * The UI continues to work via Zustand stores (instant), 
 * while this hook silently persists changes to the DB.
 */

"use client";

import { useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useCanvasStore } from "@/store/canvasStore";

// Default workspace ID — will be replaced by WorkspaceProvider later
// For now, we use a hardcoded fallback that gets resolved on first load
let cachedWorkspaceId: string | null = null;

/**
 * Hook to sync project list from backend to local store.
 * Use on the dashboard page.
 */
export function useProjectListSync() {
  const workspaceQuery = trpc.workspace.list.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const workspaceId = workspaceQuery.data?.[0]?.id ?? null;

  const projectsQuery = trpc.project.list.useQuery(
    { workspaceId: workspaceId! },
    {
      enabled: !!workspaceId,
      retry: 1,
      refetchOnWindowFocus: false,
    }
  );

  // Cache the workspace ID for other hooks
  useEffect(() => {
    if (workspaceId) {
      cachedWorkspaceId = workspaceId;
    }
  }, [workspaceId]);

  return {
    workspaceId,
    projects: projectsQuery.data ?? [],
    isLoading: workspaceQuery.isLoading || projectsQuery.isLoading,
    isError: workspaceQuery.isError || projectsQuery.isError,
    refetch: projectsQuery.refetch,
  };
}

/**
 * Hook to auto-save canvas state to the backend.
 * Use in the editor page.
 */
export function useCanvasAutoSave(projectId: string) {
  const saveStateMutation = trpc.project.saveState.useMutation();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>("");

  const saveNow = useCallback(() => {
    const store = useCanvasStore.getState();

    // Serialize current canvas state
    const canvasState = {
      layers: store.layers,
      masterComponents: store.masterComponents,
      componentInstances: store.componentInstances,
      resizes: store.resizes,
      artboardProps: store.artboardProps,
      canvasWidth: store.canvasWidth,
      canvasHeight: store.canvasHeight,
    };

    const serialized = JSON.stringify(canvasState);

    // Skip if nothing changed
    if (serialized === lastSavedRef.current) return;
    lastSavedRef.current = serialized;

    saveStateMutation.mutate(
      { id: projectId, canvasState },
      {
      onError: (err: { message: string }) => {
          console.warn("Auto-save failed:", err.message);
        },
      }
    );
  }, [projectId, saveStateMutation]);

  // Subscribe to canvas store changes and debounce saves
  useEffect(() => {
    const unsubscribe = useCanvasStore.subscribe(() => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(saveNow, 3000); // Save 3s after last change
    });

    return () => {
      unsubscribe();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [saveNow]);

  // Save on unmount (leaving editor)
  useEffect(() => {
    return () => {
      saveNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isSaving: saveStateMutation.isPending,
    lastError: saveStateMutation.error,
  };
}

/**
 * Hook to load canvas state from backend when entering the editor.
 * Restores the full canvas state into canvasStore.
 * IMPORTANT: Always resets canvas when projectId changes to prevent
 * showing stale content from a previous project.
 */
export function useLoadCanvasState(projectId: string) {
  const prevProjectIdRef = useRef<string | null>(null);

  // Clear canvas immediately when switching to a different project
  useEffect(() => {
    if (prevProjectIdRef.current && prevProjectIdRef.current !== projectId) {
      // Reset canvas to empty state
      useCanvasStore.setState({
        layers: [],
        selectedLayerIds: [],
        masterComponents: [],
        componentInstances: [],
        history: [],
        future: [],
      });
    }
    prevProjectIdRef.current = projectId;
  }, [projectId]);

  const canvasQuery = trpc.project.loadState.useQuery(
    { id: projectId },
    {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnMount: "always", // Always fetch fresh data
    }
  );

  useEffect(() => {
    if (canvasQuery.data && typeof canvasQuery.data === "object") {
      const state = canvasQuery.data as Record<string, unknown>;

      if (state.layers && Array.isArray(state.layers)) {
        // Restore canvas state from DB — always overwrite
        useCanvasStore.setState({
          layers: state.layers as ReturnType<typeof useCanvasStore.getState>["layers"],
          masterComponents: (state.masterComponents ?? []) as ReturnType<typeof useCanvasStore.getState>["masterComponents"],
          componentInstances: (state.componentInstances ?? []) as ReturnType<typeof useCanvasStore.getState>["componentInstances"],
          resizes: (state.resizes ?? useCanvasStore.getState().resizes) as ReturnType<typeof useCanvasStore.getState>["resizes"],
          artboardProps: (state.artboardProps ?? useCanvasStore.getState().artboardProps) as ReturnType<typeof useCanvasStore.getState>["artboardProps"],
          canvasWidth: (state.canvasWidth ?? useCanvasStore.getState().canvasWidth) as number,
          canvasHeight: (state.canvasHeight ?? useCanvasStore.getState().canvasHeight) as number,
        });
      }
    } else if (canvasQuery.isError || (canvasQuery.isFetched && !canvasQuery.data)) {
      // Project not in DB or no state saved — start with clean canvas
      useCanvasStore.setState({
        layers: [],
        selectedLayerIds: [],
      });
    }
  }, [canvasQuery.data, canvasQuery.isError, canvasQuery.isFetched]);

  return {
    isLoading: canvasQuery.isLoading,
    isError: canvasQuery.isError,
  };
}

/**
 * Hook for creating a project that syncs to backend.
 */
export function useCreateProjectSync() {
  const createMutation = trpc.project.create.useMutation();

  const createProject = useCallback(
    async (data: { name: string; goal: string; workspaceId?: string }) => {
      const wsId = data.workspaceId ?? cachedWorkspaceId;
      if (!wsId) {
        console.warn("No workspace ID available for project creation");
        return null;
      }

      try {
        const project = await createMutation.mutateAsync({
          name: data.name,
          workspaceId: wsId,
          goal: data.goal,
        });
        return project;
      } catch (err) {
        console.error("Failed to create project on backend:", err);
        return null;
      }
    },
    [createMutation]
  );

  return {
    createProject,
    isPending: createMutation.isPending,
  };
}

export { cachedWorkspaceId };
