"use client";

/**
 * WorkspaceProvider
 *
 * React Context for the currently selected workspace.
 * Persists selection in localStorage. Used across dashboard, sidebar, etc.
 * Provides currentRole and isAdmin for RBAC-aware UI.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  businessUnit: string;
  role: string;
}

interface WorkspaceContextValue {
  /** List of workspaces the user belongs to */
  workspaces: WorkspaceInfo[];
  /** Currently selected workspace */
  currentWorkspace: WorkspaceInfo | null;
  /** Switch to a different workspace */
  setWorkspaceId: (id: string) => void;
  /** Whether workspace data is loading */
  isLoading: boolean;
  /** Whether the user has no workspaces (needs onboarding) */
  needsOnboarding: boolean;
  /** Refetch workspace list (after join/leave) */
  refetch: () => void;
  /** Current user's role in the active workspace */
  currentRole: string | null;
  /** Shortcut: is the current user an admin? */
  isAdmin: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaces: [],
  currentWorkspace: null,
  setWorkspaceId: () => {},
  isLoading: true,
  needsOnboarding: false,
  refetch: () => {},
  currentRole: null,
  isAdmin: false,
});

const LS_KEY = "acp_workspace_id";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load saved workspace ID from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) setSelectedId(saved);
  }, []);

  const workspaceQuery = trpc.workspace.list.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const workspaces = (workspaceQuery.data ?? []) as WorkspaceInfo[];

  // Determine current workspace
  const currentWorkspace =
    workspaces.find((ws) => ws.id === selectedId) ??
    workspaces[0] ??
    null;

  // Derived role info
  const currentRole = currentWorkspace?.role ?? null;
  const isAdmin = currentRole === "ADMIN";

  // If selectedId doesn't match any workspace, auto-select first
  useEffect(() => {
    if (workspaces.length > 0 && !workspaces.find((ws) => ws.id === selectedId)) {
      const firstId = workspaces[0].id;
      setSelectedId(firstId);
      localStorage.setItem(LS_KEY, firstId);
    }
  }, [workspaces, selectedId]);

  const setWorkspaceId = useCallback((id: string) => {
    setSelectedId(id);
    localStorage.setItem(LS_KEY, id);
  }, []);

  const refetch = useCallback(() => {
    workspaceQuery.refetch();
  }, [workspaceQuery]);

  const needsOnboarding =
    !workspaceQuery.isLoading && workspaces.length === 0;

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        currentWorkspace,
        setWorkspaceId,
        isLoading: workspaceQuery.isLoading,
        needsOnboarding,
        refetch,
        currentRole,
        isAdmin,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
