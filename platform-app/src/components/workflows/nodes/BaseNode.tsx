"use client";

/**
 * BaseNode — visual shell for the four node types. Pulls run-state from the
 * workflow store so the canvas reflects executor progress live (Phase 4).
 *
 * For `mask` and `blur` nodes we also render a live B&W preview of the
 * current parameters (Figma-style layer-mask visualisation) so users can see
 * where the effect applies without running the workflow.
 */

import { Handle, Position } from "@xyflow/react";
import { useMemo, type MouseEvent } from "react";
import {
    AlertCircle,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Check,
    FileText,
    Image as ImageIcon,
    Loader2,
    MinusCircle,
    Play,
} from "lucide-react";
import {
    NODE_REGISTRY,
    type WorkflowEdge,
    type WorkflowNode,
    type WorkflowNodeType,
} from "@/server/workflow/types";
import { useWorkflowStore } from "@/store/workflow/useWorkflowStore";
import type { NodeResult, NodeRunStatus } from "@/store/workflow/types";
import { useWorkflowRunControls } from "../WorkflowRunControlsContext";
import { getWorkflowNodePreview, type WorkflowNodePreview } from "./preview";

interface BaseNodeProps {
    id: string;
    type: WorkflowNodeType;
    selected?: boolean;
}

type LinearDir =
    | "top-to-bottom"
    | "bottom-to-top"
    | "left-to-right"
    | "right-to-left";

const CATEGORY_META: Record<
    "input" | "ai" | "transform" | "output",
    { label: string; dot: string }
> = {
    input: {
        label: "Источник",
        dot: "bg-status-published",
    },
    ai: {
        label: "AI",
        dot: "bg-status-review",
    },
    transform: {
        label: "Трансформ",
        dot: "bg-status-progress",
    },
    output: {
        label: "Выход",
        dot: "bg-status-draft",
    },
};

const STATUS_RING: Record<NodeRunStatus, string> = {
    idle: "",
    running: "ring-2 ring-status-progress",
    done: "",
    error: "ring-2 ring-red-500",
    blocked: "ring-2 ring-text-tertiary opacity-60",
};

function StatusBadge({ status }: { status: NodeRunStatus }) {
    if (status === "running")
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-status-progress" />;
    if (status === "done")
        return <Check className="h-3.5 w-3.5 text-status-published" />;
    if (status === "error")
        return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
    if (status === "blocked")
        return <MinusCircle className="h-3.5 w-3.5 text-text-tertiary" />;
    return null;
}

export function BaseNode({ id, type, selected }: BaseNodeProps) {
    const definition = NODE_REGISTRY[type];
    const category = CATEGORY_META[definition.category];
    const status = useWorkflowStore((s) => s.runState[id] ?? "idle");
    const result = useWorkflowStore((s) => s.runResults[id]);
    const params = useWorkflowStore(
        (s) =>
            s.nodes.find((n) => n.id === id)?.data.params ??
            (undefined as Record<string, unknown> | undefined),
    );
    const runError = useWorkflowStore((s) => s.runError);
    const errorMessage = runError?.nodeId === id ? runError.message : undefined;
    const preview = getWorkflowNodePreview(type, params, result);
    const nodes = useWorkflowStore((s) => s.nodes);
    const edges = useWorkflowStore((s) => s.edges);
    const runResults = useWorkflowStore((s) => s.runResults);
    const connectedInputs = useMemo(
        () =>
            getConnectedInputGroups({
                nodeId: id,
                type,
                nodes,
                edges,
                runResults,
            }),
        [edges, id, nodes, runResults, type],
    );
    const hasParamPreview = type === "mask" || type === "blur";
    const runControls = useWorkflowRunControls();
    const nodeRunDisabledReason = runControls?.getNodeRunDisabledReason(id);
    const canRunNode = Boolean(runControls && !nodeRunDisabledReason);

    const runSelectedNode = (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!canRunNode) return;
        void runControls?.runNode(id);
    };

    return (
        <div
            className={[
                "group relative min-w-[230px] max-w-[300px] overflow-visible rounded-[var(--radius-lg)] border border-border-primary bg-bg-surface/95 text-text-primary shadow-[var(--shadow-md)] backdrop-blur transition duration-200 hover:border-border-secondary hover:shadow-[var(--shadow-lg)]",
                STATUS_RING[status],
                selected && (status === "idle" || status === "done")
                    ? "ring-2 ring-border-focus/80"
                    : "",
            ].join(" ")}
            title={errorMessage}
        >
            <div className="px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                        <span className={`h-1.5 w-1.5 rounded-full ${category.dot}`} />
                        <span className="truncate">{category.label}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <StatusBadge status={status} />
                        {runControls && (
                            <button
                                type="button"
                                onClick={runSelectedNode}
                                onPointerDown={(event) => event.stopPropagation()}
                                disabled={!canRunNode}
                                tabIndex={selected ? 0 : -1}
                                title={
                                    nodeRunDisabledReason ??
                                    `Запустить «${definition.displayName}»`
                                }
                                aria-label={`Запустить ноду «${definition.displayName}»`}
                                className={[
                                    "nodrag nopan flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] border border-border-primary bg-bg-surface text-text-secondary shadow-[var(--shadow-sm)] transition duration-150 hover:border-border-secondary hover:bg-bg-tertiary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus/50 disabled:cursor-not-allowed disabled:opacity-40",
                                    selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                                ].join(" ")}
                            >
                                {status === "running" ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Play className="h-3.5 w-3.5" />
                                )}
                            </button>
                        )}
                    </div>
                </div>
                <div className="mt-1 truncate text-sm font-semibold">
                    {definition.displayName}
                </div>
                {definition.description && (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-text-secondary">
                        {definition.description}
                    </p>
                )}
            </div>

            <div className="px-3 pb-3">
                {type === "mask" && <MaskPreview params={params} />}
                {type === "blur" && <BlurPreview params={params} />}
                {connectedInputs && <ConnectedInputChips groups={connectedInputs} />}
                {type === "textGeneration" ? (
                    <NodeTextPreview text={preview?.text} />
                ) : (
                    (!hasParamPreview || preview) && (
                        <NodeImagePreview preview={preview} type={type} />
                    )
                )}
                {type === "assetOutput" && result?.assetId && (
                    <div className="mt-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary px-2.5 py-2 text-[11px] text-text-secondary">
                        Сохранено в библиотеку:{" "}
                        <span className="font-mono text-text-primary">{result.assetId}</span>
                    </div>
                )}
                {errorMessage && (
                    <div className="mt-2 rounded-[var(--radius-md)] border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-500">
                        {errorMessage}
                    </div>
                )}
            </div>

            {definition.inputs.map((port, idx) => (
                <Handle
                    key={port.id}
                    type="target"
                    position={Position.Left}
                    id={port.id}
                    className="workflow-handle"
                    data-port-type={port.type}
                    title={port.label}
                    style={{
                        top: `${58 + idx * 18}px`,
                        background: "transparent",
                        border: 0,
                        height: 24,
                        width: 24,
                    }}
                />
            ))}

            {definition.outputs.map((port, idx) => (
                <Handle
                    key={port.id}
                    type="source"
                    position={Position.Right}
                    id={port.id}
                    className="workflow-handle"
                    data-port-type={port.type}
                    title={port.label}
                    style={{
                        top: `${58 + idx * 18}px`,
                        background: "transparent",
                        border: 0,
                        height: 24,
                        width: 24,
                    }}
                />
            ))}
        </div>
    );
}

function NodeImagePreview({
    preview,
    type,
}: {
    preview: WorkflowNodePreview | null;
    type: WorkflowNodeType;
}) {
    const large = type === "imageInput" || type === "preview";
    const heightClass = large ? "h-36" : "h-24";
    const alt =
        preview?.source === "input"
            ? "Выбранное изображение для workflow"
            : "Последний результат узла workflow";

    return (
        <div
            className={`workflow-transparent-bg relative mt-2 overflow-hidden rounded-[var(--radius-md)] border border-border-primary ${heightClass}`}
        >
            {preview ? (
                <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={preview.url ?? ""}
                        alt={alt}
                        className="h-full w-full object-contain"
                    />
                    <div className="absolute left-2 top-2 rounded-[var(--radius-full)] border border-border-primary bg-bg-surface/90 px-2 py-0.5 text-[10px] font-medium text-text-secondary shadow-[var(--shadow-sm)] backdrop-blur">
                        {preview.source === "input" ? "Источник" : "Результат"}
                    </div>
                </>
            ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 bg-bg-secondary/80 text-text-tertiary">
                    <ImageIcon className="h-5 w-5" />
                    <span className="text-[11px]">
                        {type === "imageInput" ? "Выберите изображение" : "Нет результата"}
                    </span>
                </div>
            )}
        </div>
    );
}

function NodeTextPreview({ text }: { text: string | undefined }) {
    return (
        <div className="mt-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary px-3 py-3">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                {text ? "Результат" : "Текст"}
            </div>
            <p
                className={[
                    "line-clamp-5 whitespace-pre-wrap text-xs leading-5",
                    text ? "text-text-primary" : "text-text-tertiary",
                ].join(" ")}
            >
                {text ?? "Нет результата"}
            </p>
        </div>
    );
}

interface ConnectedInputItem {
    id: string;
    label: string;
    imageUrl?: string;
    text?: string;
}

interface ConnectedInputGroup {
    title: string;
    kind: "image" | "text";
    items: ConnectedInputItem[];
}

function getConnectedInputGroups({
    nodeId,
    type,
    nodes,
    edges,
    runResults,
}: {
    nodeId: string;
    type: WorkflowNodeType;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    runResults: Record<string, NodeResult>;
}): ConnectedInputGroup[] | null {
    if (type !== "imageGeneration" && type !== "textGeneration") return null;

    const imageTitle = type === "imageGeneration" ? "Референсы" : "Источники";
    const textTitle = type === "imageGeneration" ? "Промпт" : "Задача";
    const incoming = edges.filter((edge) => edge.target === nodeId);

    const imageItems: ConnectedInputItem[] = [];
    const textItems: ConnectedInputItem[] = [];

    for (const edge of incoming) {
        const sourceNode = nodes.find((node) => node.id === edge.source);
        if (!sourceNode) continue;
        const sourceDefinition = NODE_REGISTRY[sourceNode.type];
        const sourceResult = runResults[sourceNode.id];
        const sourcePreview = getWorkflowNodePreview(
            sourceNode.type,
            sourceNode.data.params,
            sourceResult,
        );

        const isContextHandle =
            edge.targetHandle === "context-in" ||
            edge.targetHandle === "reference-images" ||
            edge.targetHandle === "source-images" ||
            edge.targetHandle === "prompt-in";

        if (isContextHandle && (sourcePreview?.url || sourceResult?.url)) {
            imageItems.push({
                id: edge.id,
                label: sourceDefinition.displayName,
                imageUrl: sourcePreview?.url ?? sourceResult?.url,
            });
        }

        if (isContextHandle && (sourceResult?.text || sourceNode.type === "textGeneration")) {
            const promptPreview =
                sourceResult?.text ??
                (typeof sourceNode.data.params.prompt === "string"
                    ? sourceNode.data.params.prompt
                    : undefined);
            textItems.push({
                id: edge.id,
                label: sourceDefinition.displayName,
                text: promptPreview,
            });
        }
    }

    const groups: ConnectedInputGroup[] = [];
    if (imageItems.length > 0) {
        groups.push({ title: imageTitle, kind: "image", items: imageItems });
    }
    if (textItems.length > 0) {
        groups.push({ title: textTitle, kind: "text", items: textItems });
    }
    return groups.length > 0 ? groups : null;
}

function ConnectedInputChips({ groups }: { groups: ConnectedInputGroup[] }) {
    return (
        <div className="mt-2 space-y-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary/80 px-2.5 py-2">
            {groups.map((group) => (
                <div key={group.title}>
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                        {group.title}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {group.items.map((item) =>
                            group.kind === "image" ? (
                                <div
                                    key={item.id}
                                    className="workflow-transparent-bg flex h-9 w-9 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-border-primary bg-bg-tertiary"
                                    title={item.label}
                                >
                                    {item.imageUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={item.imageUrl}
                                            alt={item.label}
                                            className="h-full w-full object-cover"
                                        />
                                    ) : (
                                        <ImageIcon className="h-4 w-4 text-text-tertiary" />
                                    )}
                                </div>
                            ) : (
                                <div
                                    key={item.id}
                                    className="flex max-w-full items-center gap-1.5 rounded-[var(--radius-sm)] border border-border-primary bg-bg-surface px-2 py-1 text-[10px] text-text-secondary"
                                    title={item.text ?? item.label}
                                >
                                    <FileText className="h-3 w-3 shrink-0 text-text-tertiary" />
                                    <span className="max-w-[210px] truncate">
                                        {item.text || item.label}
                                    </span>
                                </div>
                            ),
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─── Preview helpers (Figma Layer Mask / Layer Blur parity) ─────────────────

function clamp01(v: unknown, fallback: number): number {
    if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
    return Math.max(0, Math.min(1, v));
}

function clampPx(v: unknown, fallback: number): number {
    if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
    return Math.max(0, Math.min(50, v));
}

/**
 * CSS linear-gradient angle that matches the server-side SVG convention:
 * the gradient goes FROM start-of-direction TO end-of-direction.
 */
function cssAngleFor(direction: LinearDir): string {
    switch (direction) {
        case "top-to-bottom":
            return "to bottom";
        case "bottom-to-top":
            return "to top";
        case "left-to-right":
            return "to right";
        case "right-to-left":
            return "to left";
    }
}

function DirectionArrow({ direction }: { direction: LinearDir }) {
    const common = "h-3 w-3";
    switch (direction) {
        case "top-to-bottom":
            return <ArrowDown className={common} />;
        case "bottom-to-top":
            return <ArrowUp className={common} />;
        case "left-to-right":
            return <ArrowRight className={common} />;
        case "right-to-left":
            return <ArrowLeft className={common} />;
    }
}

/** 4-stop grayscale gradient matching the server-side SVG exactly. */
function gradientBackground(
    direction: LinearDir,
    startPos: number,
    endPos: number,
    startValue: number,
    endValue: number,
): string {
    const angle = cssAngleFor(direction);
    const spPct = (startPos * 100).toFixed(2);
    const epPct = (endPos * 100).toFixed(2);
    const s = Math.round(startValue * 255);
    const e = Math.round(endValue * 255);
    return `linear-gradient(${angle}, rgb(${s},${s},${s}) 0%, rgb(${s},${s},${s}) ${spPct}%, rgb(${e},${e},${e}) ${epPct}%, rgb(${e},${e},${e}) 100%)`;
}

function MaskPreview({ params }: { params: Record<string, unknown> | undefined }) {
    const direction =
        (params?.direction as LinearDir | undefined) ?? "bottom-to-top";
    const startPos = clamp01(params?.startPos, 0);
    const endPos = clamp01(params?.endPos, 0.5);
    const startAlpha = clamp01(params?.startAlpha, 0);
    const endAlpha = clamp01(params?.endAlpha, 1);

    return (
        <div className="mt-2">
            <div
                className="h-16 w-full rounded border border-border-primary"
                style={{
                    background: gradientBackground(
                        direction,
                        startPos,
                        endPos,
                        startAlpha,
                        endAlpha,
                    ),
                }}
                aria-label="Mask preview"
            />
            <div className="mt-1 flex items-center justify-between text-[10px] text-text-tertiary">
                <span className="inline-flex items-center gap-1">
                    <DirectionArrow direction={direction} />
                    <span>
                        {(startPos * 100).toFixed(0)}% → {(endPos * 100).toFixed(0)}%
                    </span>
                </span>
                <span>
                    α {startAlpha.toFixed(2)} → {endAlpha.toFixed(2)}
                </span>
            </div>
        </div>
    );
}

function BlurPreview({ params }: { params: Record<string, unknown> | undefined }) {
    const mode =
        (params?.mode as "uniform" | "progressive" | undefined) ?? "progressive";

    if (mode === "uniform") {
        const intensity = clampPx(params?.intensity, 4);
        return (
            <div className="mt-2 rounded border border-border-primary bg-bg-tertiary px-2 py-1.5 text-[10px] text-text-tertiary">
                Uniform · {intensity.toFixed(0)} px
            </div>
        );
    }

    const direction =
        (params?.direction as LinearDir | undefined) ?? "bottom-to-top";
    const startPos = clamp01(params?.startPos, 0);
    const endPos = clamp01(params?.endPos, 0.5);
    const startIntensity = clampPx(params?.startIntensity, 16);
    const endIntensity = clampPx(params?.endIntensity, 0);
    // Normalise intensities to [0,1] for the visualisation — white = max blur.
    const max = Math.max(startIntensity, endIntensity, 1);
    const startNorm = startIntensity / max;
    const endNorm = endIntensity / max;

    return (
        <div className="mt-2">
            <div
                className="h-16 w-full rounded border border-border-primary"
                style={{
                    background: gradientBackground(
                        direction,
                        startPos,
                        endPos,
                        startNorm,
                        endNorm,
                    ),
                }}
                aria-label="Blur preview"
            />
            <div className="mt-1 flex items-center justify-between text-[10px] text-text-tertiary">
                <span className="inline-flex items-center gap-1">
                    <DirectionArrow direction={direction} />
                    <span>
                        {(startPos * 100).toFixed(0)}% → {(endPos * 100).toFixed(0)}%
                    </span>
                </span>
                <span>
                    {startIntensity.toFixed(0)}px → {endIntensity.toFixed(0)}px
                </span>
            </div>
        </div>
    );
}
