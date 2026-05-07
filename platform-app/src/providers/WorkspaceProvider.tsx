"use client";

/**
 * WorkspaceProvider
 *
 * React Context for the currently selected workspace.
 * Persists selection in localStorage. Used across dashboard, sidebar, etc.
 * Provides currentRole and isAdmin for RBAC-aware UI.
 */

import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  businessUnit: string;
  role: string;
  logoUrl?: string | null;
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
  /**
   * Shortcut: is the current user an admin in the active workspace?
   * SUPER_ADMIN counts as workspace admin everywhere.
   */
  isAdmin: boolean;
  /** Platform-level SUPER_ADMIN flag (User.role === "SUPER_ADMIN") */
  isSuperAdmin: boolean;
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
  isSuperAdmin: false,
});

export const WORKSPACE_STORAGE_KEY = "acp_workspace_id";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(WORKSPACE_STORAGE_KEY);
  });

  const workspaceQuery = trpc.workspace.list.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: false,
  });

  // Pull the current user's global role (SUPER_ADMIN | USER) once. We don't
  // refetch this on focus — global role doesn't change mid-session.
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  const workspaces = useMemo(
    () => (workspaceQuery.data ?? []) as WorkspaceInfo[],
    [workspaceQuery.data],
  );

  // Determine current workspace
  const currentWorkspace =
    workspaces.find((ws) => ws.id === selectedId) ??
    workspaces[0] ??
    null;

  // Derived role info. SUPER_ADMIN is treated as workspace admin everywhere
  // so admin-gated UI (e.g. AI styles visibility) Just Works for platform admins
  // even in workspaces where their member role is CREATOR/USER.
  const currentRole = currentWorkspace?.role ?? null;
  const isSuperAdmin = meQuery.data?.role === "SUPER_ADMIN";
  const isAdmin = currentRole === "ADMIN" || isSuperAdmin;

  // Keep persisted selection valid without adding an extra render.
  useEffect(() => {
    if (workspaces.length > 0 && !workspaces.find((ws) => ws.id === selectedId)) {
      const firstId = workspaces[0].id;
      localStorage.setItem(WORKSPACE_STORAGE_KEY, firstId);
    }
  }, [workspaces, selectedId]);

  const setWorkspaceId = useCallback((id: string) => {
    setSelectedId(id);
    localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
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
        isSuperAdmin,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
