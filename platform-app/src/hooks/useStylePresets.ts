/**
 * useStylePresets – React hook for loading workspace-aware style presets.
 *
 * Fetches custom presets from the AIPreset DB table via tRPC,
 * then merges them with system presets from stylePresets.ts.
 *
 * Usage:
 *   const { imagePresets, textPresets, isLoading } = useStylePresets();
 */

import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import {
  SYSTEM_IMAGE_PRESETS,
  SYSTEM_TEXT_PRESETS,
  mergeImagePresets,
  mergeTextPresets,
  type ImageStylePreset,
  type TextStylePreset,
} from "@/lib/stylePresets";

export function useStylePresets() {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;

  // Fetch image presets from DB
  const imageQuery = trpc.ai.listPresets.useQuery(
    { workspaceId: workspaceId!, type: "image" },
    { enabled: !!workspaceId, staleTime: 60_000 },
  );

  // Fetch text presets from DB
  const textQuery = trpc.ai.listPresets.useQuery(
    { workspaceId: workspaceId!, type: "text" },
    { enabled: !!workspaceId, staleTime: 60_000 },
  );

  // Merge system + DB presets
  const imagePresets = useMemo<ImageStylePreset[]>(() => {
    if (!imageQuery.data || imageQuery.data.length === 0) {
      return SYSTEM_IMAGE_PRESETS;
    }
    return mergeImagePresets(imageQuery.data);
  }, [imageQuery.data]);

  const textPresets = useMemo<TextStylePreset[]>(() => {
    if (!textQuery.data || textQuery.data.length === 0) {
      return SYSTEM_TEXT_PRESETS;
    }
    return mergeTextPresets(textQuery.data);
  }, [textQuery.data]);

  return {
    imagePresets,
    textPresets,
    isLoading: imageQuery.isLoading || textQuery.isLoading,
    /** Refetch after creating/editing/deleting a preset */
    refetch: () => {
      imageQuery.refetch();
      textQuery.refetch();
    },
  };
}
