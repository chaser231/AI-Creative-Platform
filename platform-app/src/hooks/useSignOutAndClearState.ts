"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { signOut } from "next-auth/react";
import { WORKSPACE_STORAGE_KEY } from "@/providers/WorkspaceProvider";
import { logAuthDiagnostic } from "@/lib/authDiagnostics";

export function useSignOutAndClearState(callbackUrl = "/auth/signin") {
  const queryClient = useQueryClient();

  return useCallback(() => {
    logAuthDiagnostic("logout_started", {
      callbackUrl,
      pathname: window.location.pathname,
    });
    queryClient.clear();
    localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    return signOut({ callbackUrl });
  }, [callbackUrl, queryClient]);
}
