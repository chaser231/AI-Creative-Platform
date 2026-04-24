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
import { AlertCircle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Loader2, MinusCircle } from "lucide-react";
import { NODE_REGISTRY, type WorkflowNodeType } from "@/server/workflow/types";
import { useWorkflowStore } from "@/store/workflow/useWorkflowStore";
import type { NodeRunStatus } from "@/store/workflow/types";

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

const CATEGORY_ACCENT: Record<"input" | "ai" | "transform" | "output", string> = {
    input: "border-l-emerald-400",
    ai: "border-l-violet-400",
    transform: "border-l-sky-400",
    output: "border-l-amber-400",
};

const STATUS_RING: Record<NodeRunStatus, string> = {
    idle: "",
    running: "ring-2 ring-status-progress",
    done: "ring-2 ring-status-published",
    error: "ring-2 ring-red-500",
    blocked: "ring-2 ring-text-tertiary opacity-60",
};

const CHECKERBOARD_BG =
    "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><rect width=\"8\" height=\"8\" fill=\"%23e5e7eb\"/><rect x=\"8\" y=\"8\" width=\"8\" height=\"8\" fill=\"%23e5e7eb\"/></svg>')";

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
    const accent = CATEGORY_ACCENT[definition.category];
    const status = useWorkflowStore((s) => s.runState[id] ?? "idle");
    const result = useWorkflowStore((s) => s.runResults[id]);
    const params = useWorkflowStore(
        (s) =>
            s.nodes.find((n) => n.id === id)?.data.params ??
            (undefined as Record<string, unknown> | undefined),
    );
    const runError = useWorkflowStore((s) => s.runError);
    const errorMessage = runError?.nodeId === id ? runError.message : undefined;

    return (
        <div
            className={[
                "min-w-[180px] rounded-md border border-border-primary border-l-4 bg-bg-surface px-3 py-2 text-text-primary shadow-sm transition",
                accent,
                STATUS_RING[status],
                selected && status === "idle" ? "ring-2 ring-border-focus" : "",
            ].join(" ")}
            title={errorMessage}
        >
            <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] uppercase tracking-wide text-text-tertiary">
                    {definition.category}
                </div>
                <StatusBadge status={status} />
            </div>
            <div className="mt-0.5 text-sm font-medium">
                {definition.displayName}
            </div>

            {type === "mask" && <MaskPreview params={params} />}
            {type === "blur" && <BlurPreview params={params} />}

            {result?.url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                    src={result.url}
                    alt=""
                    className={
                        type === "preview"
                            ? "mt-2 w-full max-w-[300px] rounded border border-border-primary object-contain"
                            : "mt-2 h-12 w-full rounded border border-border-primary object-cover"
                    }
                    style={
                        type === "preview"
                            ? {
                                  backgroundImage: CHECKERBOARD_BG,
                                  backgroundRepeat: "repeat",
                              }
                            : undefined
                    }
                />
            )}

            {definition.inputs.map((port, idx) => (
                <Handle
                    key={port.id}
                    type="target"
                    position={Position.Left}
                    id={port.id}
                    data-port-type={port.type}
                    style={{ top: `${30 + idx * 16}px`, background: "#6366f1" }}
                />
            ))}

            {definition.outputs.map((port, idx) => (
                <Handle
                    key={port.id}
                    type="source"
                    position={Position.Right}
                    id={port.id}
                    data-port-type={port.type}
                    style={{ top: `${30 + idx * 16}px`, background: "#6366f1" }}
                />
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
