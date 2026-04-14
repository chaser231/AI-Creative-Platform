/**
 * useAssetUpload Hook
 *
 * Handles client-side file upload to Yandex Object Storage via presigned URLs.
 * Flow: get presigned URL from backend → PUT file directly to S3 → asset record in DB.
 */

"use client";

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { cachedWorkspaceId } from "@/hooks/useProjectSync";
import { useWorkspace } from "@/providers/WorkspaceProvider";

type AssetType = "IMAGE" | "VIDEO" | "AUDIO" | "FONT" | "LOGO" | "OTHER";

interface UploadProgress {
  status: "idle" | "uploading" | "done" | "error";
  progress: number; // 0-100
  error?: string;
}

/**
 * Hook for uploading files to S3 via presigned URLs.
 */
export function useAssetUpload() {
  const [uploadState, setUploadState] = useState<UploadProgress>({
    status: "idle",
    progress: 0,
  });

  const getUploadUrlMutation = trpc.asset.getUploadUrl.useMutation();

  const uploadFile = useCallback(
    async (
      file: File,
      options?: { type?: AssetType; workspaceId?: string; metadata?: Record<string, unknown> }
    ) => {
      const wsId = options?.workspaceId ?? cachedWorkspaceId;
      if (!wsId) {
        setUploadState({ status: "error", progress: 0, error: "No workspace ID" });
        return null;
      }

      // Determine asset type from MIME
      const type: AssetType = options?.type ?? inferAssetType(file.type);

      setUploadState({ status: "uploading", progress: 10 });

      try {
        // Step 1: Get presigned URL from backend
        const { uploadUrl, asset } = await getUploadUrlMutation.mutateAsync({
          workspaceId: wsId,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          type,
          metadata: options?.metadata,
        });

        setUploadState({ status: "uploading", progress: 30 });

        // Step 2: Upload file directly to S3
        const response = await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: {
            "Content-Type": file.type,
          },
        });

        if (!response.ok) {
          throw new Error(`S3 upload failed: ${response.status}`);
        }

        setUploadState({ status: "done", progress: 100 });
        return asset;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        setUploadState({ status: "error", progress: 0, error: message });
        console.error("Asset upload failed:", err);
        return null;
      }
    },
    [getUploadUrlMutation]
  );

  const reset = useCallback(() => {
    setUploadState({ status: "idle", progress: 0 });
  }, []);

  return {
    uploadFile,
    ...uploadState,
    reset,
  };
}

/**
 * Hook to list assets from the backend.
 */
export function useAssetList(type?: AssetType) {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id ?? cachedWorkspaceId ?? null;

  const assetsQuery = trpc.asset.list.useQuery(
    { workspaceId: workspaceId!, type },
    {
      enabled: !!workspaceId,
      retry: 1,
      refetchOnWindowFocus: false,
    }
  );

  return {
    assets: assetsQuery.data ?? [],
    isLoading: assetsQuery.isLoading,
    isError: assetsQuery.isError,
    refetch: assetsQuery.refetch,
  };
}

/**
 * Hook to delete an asset.
 */
export function useAssetDelete() {
  const deleteMutation = trpc.asset.delete.useMutation();

  const deleteAsset = useCallback(
    async (id: string) => {
      try {
        await deleteMutation.mutateAsync({ id });
        return true;
      } catch (err) {
        console.error("Asset delete failed:", err);
        return false;
      }
    },
    [deleteMutation]
  );

  return {
    deleteAsset,
    isPending: deleteMutation.isPending,
  };
}

// ─── Helpers ────────────────────────────────────────────

function inferAssetType(mimeType: string): AssetType {
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  if (mimeType.includes("font")) return "FONT";
  return "OTHER";
}
