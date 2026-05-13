/**
 * useLoraPresets — load LoRA presets visible to the caller for a given
 * model family. The tRPC `loraPreset.list` query already merges the
 * SYSTEM_LORA_CATALOG with workspace + personal DB rows, so consumers
 * only need to pass `family` (derived from the active model's
 * `loraSpec.family`).
 *
 * Usage:
 *   const { presets, isLoading, refetch } = useLoraPresets("flux-1");
 */

import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type { LoraSpec } from "@/lib/ai-models";

type LoraFamily = LoraSpec["family"];

export function useLoraPresets(family?: LoraFamily) {
    const { currentWorkspace } = useWorkspace();
    const workspaceId = currentWorkspace?.id;

    const query = trpc.loraPreset.list.useQuery(
        { workspaceId: workspaceId!, family },
        { enabled: !!workspaceId && !!family, staleTime: 60_000 },
    );

    return {
        presets: query.data ?? [],
        isLoading: query.isLoading,
        refetch: () => query.refetch(),
    };
}
