"use client";

/**
 * PaintMaskInspector — custom inspector panel for the `paintMask` workflow
 * node. Replaces the generic auto-form with a "Нарисовать маску" button that
 * opens InpaintImageModal pre-loaded with the upstream image.
 *
 * Source image resolution order:
 *   1. The last executor run result for the upstream node (`runResults`).
 *   2. The `sourceUrl` param of the upstream node when it's an `imageInput`
 *      (so the user can paint a mask before ever running the upstream node).
 *   3. Nothing — the panel renders a guidance message asking the user to
 *      connect an `image-in` edge or run the upstream node first.
 *
 * Once the user finishes painting, we re-export the mask in this node's
 * `targetWidth` × `targetHeight` (taken from the loaded image's natural
 * dimensions) and persist the resulting PNG to S3 via uploadForAI. The
 * persisted URL is written to `data.params.maskUrl` so the executor's
 * `paintMask` client handler can re-emit it without round-tripping the
 * actual pixels.
 */

import { useMemo, useState } from "react";
import { Brush, ExternalLink, Trash2 } from "lucide-react";
import { useWorkflowStore } from "@/store/workflow/useWorkflowStore";
import type { WorkflowNode } from "@/server/workflow/types";
import type { PaintMaskParams, ImageInputParams } from "@/lib/workflow/nodeParamSchemas";
import { MaskPainterModal } from "@/components/inpaint/MaskPainterModal";
import { Button } from "@/components/ui/Button";

interface PaintMaskInspectorProps {
    node: WorkflowNode;
    onPatch: (patch: Record<string, unknown>) => void;
}

function resolveUpstreamImageUrl(
    targetNodeId: string,
    nodes: WorkflowNode[],
    edges: { source: string; target: string; targetHandle: string }[],
    runResults: Record<string, { url?: string }>,
): string | null {
    const edge = edges.find(
        (e) => e.target === targetNodeId && e.targetHandle === "image-in",
    );
    if (!edge) return null;
    const cached = runResults[edge.source]?.url;
    if (cached) return cached;
    const sourceNode = nodes.find((n) => n.id === edge.source);
    if (sourceNode?.type === "imageInput") {
        const params = sourceNode.data.params as Partial<ImageInputParams>;
        if (params.sourceUrl) return params.sourceUrl;
    }
    return null;
}

export function PaintMaskInspector({ node, onPatch }: PaintMaskInspectorProps) {
    const params = node.data.params as Partial<PaintMaskParams>;
    const nodes = useWorkflowStore((s) => s.nodes);
    const edges = useWorkflowStore((s) => s.edges);
    const runResults = useWorkflowStore((s) => s.runResults);
    const [modalOpen, setModalOpen] = useState(false);

    const upstreamUrl = useMemo(
        () => resolveUpstreamImageUrl(node.id, nodes, edges, runResults),
        [node.id, nodes, edges, runResults],
    );

    const handleSave = (maskUrl: string) => {
        onPatch({ maskUrl });
    };

    const handleClear = () => {
        onPatch({ maskUrl: "" });
    };

    return (
        <div className="space-y-3">
            {upstreamUrl ? (
                <>
                    <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        onClick={() => setModalOpen(true)}
                        className="w-full rounded-[var(--radius-md)]"
                    >
                        <Brush className="h-4 w-4" />
                        {params.maskUrl ? "Перерисовать маску" : "Нарисовать маску"}
                    </Button>

                    {params.maskUrl && (
                        <div className="rounded-[var(--radius-md)] border border-border-primary bg-bg-tertiary/40 p-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={params.maskUrl}
                                alt="Painted mask preview"
                                className="mx-auto max-h-32 max-w-full rounded-sm border border-border-primary/50"
                            />
                            <div className="mt-2 flex items-center justify-between gap-2">
                                <a
                                    href={params.maskUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-primary"
                                >
                                    <ExternalLink className="h-3 w-3" />
                                    Открыть mask URL
                                </a>
                                <button
                                    type="button"
                                    onClick={handleClear}
                                    title="Очистить маску"
                                    className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-status-error"
                                >
                                    <Trash2 className="h-3 w-3" />
                                    Сброс
                                </button>
                            </div>
                        </div>
                    )}
                </>
            ) : (
                <div className="rounded-[var(--radius-md)] border border-border-primary bg-bg-tertiary/40 p-3 text-[11px] text-text-tertiary leading-relaxed">
                    Подключите вход <code className="rounded bg-bg-primary px-1">image-in</code> к ноде-источнику и убедитесь, что у источника есть URL (например, через ноду <strong>Изображение</strong>) или сначала запустите граф, чтобы появился промежуточный результат.
                </div>
            )}

            <MaskPainterModal
                open={modalOpen}
                sourceUrl={upstreamUrl ?? ""}
                onClose={() => setModalOpen(false)}
                onSave={handleSave}
                title="Маска для workflow inpaint"
            />
        </div>
    );
}
