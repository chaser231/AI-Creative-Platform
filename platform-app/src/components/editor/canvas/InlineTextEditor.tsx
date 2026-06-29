"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { TextLayer } from "@/types";
import Konva from "konva";
import { getTextRenderOffsetY, measureTextLayer } from "@/utils/layoutEngine";
import {
    artboardLengthToScreen,
    artboardToScreen,
    type OverviewViewport,
    type TileOffset,
} from "./overviewCoords";

/**
 * InlineTextEditor — Figma-like inline text editing overlay.
 *
 * Key behaviours:
 * - Transparent background so the canvas context shows through
 * - Real-time text sync: every keystroke updates the store via onUpdate
 * - Auto-resize: textarea height/width grows with content
 * - Click outside / Escape → commit; Enter → newline
 * - Escape → revert to original text
 * - Contrast-aware caret using inverted text color
 */
export function InlineTextEditor({
    layer,
    stageRef: _stageRef,
    viewport,
    tileOffset,
    onCommit,
    onUpdate,
    onDimensionsChange,
}: {
    layer: TextLayer;
    stageRef: React.RefObject<Konva.Stage | null>;
    /**
     * Stage transform used to convert artboard-local coordinates to screen
     * pixels. Single view feeds `{zoom: stage.zoom, x: stageX, y: stageY}`
     * (with `tileOffset = {0,0}`) which reduces to the legacy
     * `layer.x*zoom+stageX` formula; overview feeds the overview transform
     * plus the active tile's world offset so the textarea lines up with
     * the moved artboard.
     */
    viewport: OverviewViewport;
    tileOffset: TileOffset;
    /** Called on final commit (blur / Escape with original text) */
    onCommit: (text: string) => void;
    /** Called on every keystroke for real-time canvas sync */
    onUpdate?: (text: string) => void;
    /** Called when textarea dimensions change (unscaled layer coordinates) */
    onDimensionsChange?: (dims: { width?: number; height?: number }) => void;
}) {
    const zoom = viewport.zoom;
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [value, setValue] = useState(layer.text);
    const originalText = useRef(layer.text);
    const isCommitted = useRef(false);
    const lastReportedDims = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

    // ── Debounced store writes ──────────────────────────────────
    // The Konva text node is hidden while editing (the <textarea> renders the
    // live text), so writing to the store on every keystroke is invisible work
    // that triggers a full auto-layout pass + re-render + IndexedDB save. We
    // buffer text/dimension updates and flush them on a short trailing timer,
    // with a guaranteed flush on commit/blur and a hard cancel on Escape.
    const STORE_FLUSH_MS = 120;
    const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingText = useRef<string | null>(null);
    const pendingDims = useRef<{ width?: number; height?: number } | null>(null);

    const flushPending = useCallback(() => {
        if (flushTimer.current) {
            clearTimeout(flushTimer.current);
            flushTimer.current = null;
        }
        if (pendingText.current !== null) {
            onUpdate?.(pendingText.current);
            pendingText.current = null;
        }
        if (pendingDims.current !== null) {
            onDimensionsChange?.(pendingDims.current);
            pendingDims.current = null;
        }
    }, [onUpdate, onDimensionsChange]);

    const scheduleFlush = useCallback(() => {
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flushTimer.current = setTimeout(flushPending, STORE_FLUSH_MS);
    }, [flushPending]);

    const cancelPending = useCallback(() => {
        if (flushTimer.current) {
            clearTimeout(flushTimer.current);
            flushTimer.current = null;
        }
        pendingText.current = null;
        pendingDims.current = null;
    }, []);

    // Flush any buffered write if the editor unmounts unexpectedly.
    useEffect(() => () => { flushPending(); }, [flushPending]);

    // Artboard-local → screen via the tile-aware bridge. At single-view's
    // degenerate tile {0,0} this collapses to `layer.x*zoom + stageX` which
    // matches the legacy formula exactly.
    const screenPosition = artboardToScreen(
        { x: layer.x, y: layer.y },
        viewport,
        tileOffset,
    );
    const screenX = screenPosition.x;
    const screenY = screenPosition.y;
    const fontSizeScaled = artboardLengthToScreen(layer.fontSize, viewport);
    const letterSpacingScaled = artboardLengthToScreen(layer.letterSpacing, viewport);

    // Determine caret color — invert the text fill for contrast
    const caretColor = getContrastColor(layer.fill);

    // Compute dynamic dimensions based on textAdjust mode
    const isAutoWidth = layer.textAdjust === "auto_width";
    const isAutoHeight = layer.textAdjust === "auto_height" || !layer.textAdjust;
    const isFixed = layer.textAdjust === "fixed";

    // Mirror the static Konva render's vertical offset (the single canonical
    // `getTextRenderOffsetY`): positive when vertical trim strips the leading
    // above the first line, negative when a sub-1 line-height would otherwise
    // drift the glyphs up. CSS `translateY` is the inverse of Konva `offsetY`
    // (offsetY moves content up; translateY(-offset) reproduces that, and a
    // negative offset pushes the textarea back down — no glyph jump on
    // enter/exit of the editor).
    const renderOffsetY = getTextRenderOffsetY(layer);
    const offsetShiftScreen = artboardLengthToScreen(renderOffsetY, viewport);

    // Use the live layer dimensions from the store (updated by auto-layout)
    const screenW = Math.max(artboardLengthToScreen(layer.width, viewport), 20);
    const screenH = Math.max(artboardLengthToScreen(layer.height, viewport), fontSizeScaled * layer.lineHeight);
    const fixedVerticalAlign = layer.verticalAlign === "bottom"
        ? "flex-end"
        : layer.verticalAlign === "middle"
            ? "center"
            : "flex-start";

    // Auto-resize textarea height to match content and report dimensions back
    const autoResize = useCallback(() => {
        const ta = textareaRef.current;
        if (!ta) return;

        if (isAutoWidth) {
            ta.style.width = "0";
            ta.style.width = Math.max(ta.scrollWidth, 20) + "px";
        }

        if (isAutoHeight || isAutoWidth) {
            ta.style.height = "0";
            ta.style.height = Math.max(ta.scrollHeight, fontSizeScaled * layer.lineHeight) + "px";
        }

        // Report dimensions back using the SAME engine measurement the static
        // canvas uses (Konva + vertical trim), not the CSS scrollHeight. CSS line
        // boxes diverge from Konva's, so subtracting the trim from scrollHeight
        // left a height that didn't match the committed render — vertical trim
        // appeared to "reset" after editing until the button was toggled.
        if (onDimensionsChange) {
            const measured = measureTextLayer(
                { ...layer, text: value } as TextLayer,
                isAutoWidth ? undefined : layer.width,
            );
            const dims: { width?: number; height?: number } = {};
            if (isAutoWidth && Math.abs(measured.width - lastReportedDims.current.w) > 0.5) {
                dims.width = measured.width;
            }
            if ((isAutoHeight || isAutoWidth) && Math.abs(measured.height - lastReportedDims.current.h) > 0.5) {
                dims.height = measured.height;
            }
            if (dims.width !== undefined || dims.height !== undefined) {
                lastReportedDims.current = {
                    w: dims.width ?? lastReportedDims.current.w,
                    h: dims.height ?? lastReportedDims.current.h,
                };
                pendingDims.current = { ...pendingDims.current, ...dims };
                scheduleFlush();
            }
        }
    }, [isAutoWidth, isAutoHeight, fontSizeScaled, layer, value, onDimensionsChange, scheduleFlush]);

    // Auto-focus, select all text, and initial resize on mount
    useEffect(() => {
        const ta = textareaRef.current;
        if (ta) {
            ta.focus();
            ta.select();
            // Initial resize after font loads
            requestAnimationFrame(() => {
                autoResize();
            });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Re-resize when zoom changes
    useEffect(() => {
        autoResize();
    }, [zoom, autoResize]);

    // Commit handler — only runs once per editing session
    const doCommit = useCallback((text: string) => {
        if (isCommitted.current) return;
        isCommitted.current = true;
        // Drop any buffered keystroke writes; onCommit is the source of truth.
        cancelPending();
        onCommit(text);
    }, [onCommit, cancelPending]);

    // Handle text changes — buffered store sync + auto-resize
    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newText = e.target.value;
        setValue(newText);
        pendingText.current = newText;
        scheduleFlush();
        // Auto-resize after React processes the value change
        requestAnimationFrame(() => autoResize());
    }, [scheduleFlush, autoResize]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            // Revert to original text — discard buffered edits first.
            cancelPending();
            onUpdate?.(originalText.current);
            doCommit(originalText.current);
        }
        // Enter = newline (default textarea behavior, no preventDefault)
        // Tab = commit and move focus
        if (e.key === "Tab") {
            e.preventDefault();
            doCommit(value);
        }
    }, [doCommit, value, onUpdate, cancelPending]);

    const handleBlur = useCallback(() => {
        doCommit(value);
    }, [doCommit, value]);

    return (
        <div
            style={{
                position: "absolute",
                left: screenX,
                top: screenY,
                width: isFixed ? screenW : undefined,
                height: isFixed ? screenH : undefined,
                display: isFixed ? "flex" : undefined,
                alignItems: isFixed ? fixedVerticalAlign : undefined,
                zIndex: 50,
                transformOrigin: "top left",
                transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
            }}
        >
            <textarea
                ref={textareaRef}
                value={layer.textTransform === "uppercase" ? value.toUpperCase() : layer.textTransform === "lowercase" ? value.toLowerCase() : value}
                onChange={handleChange}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                style={{
                    // Match Konva text rendering exactly
                    display: "block",
                    transform: offsetShiftScreen ? `translateY(${-offsetShiftScreen}px)` : undefined,
                    fontSize: fontSizeScaled,
                    fontFamily: layer.fontFamily,
                    fontWeight: layer.fontWeight || "normal",
                    color: layer.fillEnabled === false ? "transparent" : layer.fill,
                    textAlign: layer.align as React.CSSProperties["textAlign"],
                    letterSpacing: letterSpacingScaled,
                    lineHeight: layer.lineHeight,
                    textTransform: layer.textTransform === "uppercase" ? "uppercase" : layer.textTransform === "lowercase" ? "lowercase" : "none",

                    // Transparent background — see canvas through editor
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    padding: 0,
                    margin: 0,
                    resize: "none",
                    overflow: "hidden",
                    caretColor: caretColor,
                    boxSizing: "border-box",
                    wordBreak: isAutoWidth ? "keep-all" : "break-word",
                    whiteSpace: isAutoWidth ? "nowrap" : "pre-wrap",
                    overflowWrap: isAutoWidth ? undefined : "break-word",

                    // Sizing based on textAdjust mode
                    width: isAutoWidth ? "auto" : screenW,
                    minWidth: isAutoWidth ? 20 : undefined,
                    height: "auto",
                    minHeight: fontSizeScaled * layer.lineHeight,

                    // Prevent text selection styling from obscuring content
                    WebkitTextFillColor: layer.fillEnabled === false ? "transparent" : layer.fill,
                }}
            />
            {/* Subtle editing indicator border — follows textarea dimensions */}
            <div
                style={{
                    position: "absolute",
                    inset: -2,
                    border: "1.5px solid var(--accent-primary)",
                    borderRadius: "var(--radius-sm)",
                    pointerEvents: "none",
                    boxShadow: "0 0 0 3px rgba(99, 102, 241, 0.15)",
                }}
            />
        </div>
    );
}

/**
 * Returns a contrasting color for caret visibility.
 * Light fills → dark caret, dark fills → light caret.
 */
function getContrastColor(fill: string): string {
    try {
        // Parse hex color
        let hex = fill.replace("#", "");
        if (hex.length === 3) {
            hex = hex.split("").map(c => c + c).join("");
        }
        if (hex.length !== 6) return "#6366F1"; // fallback to accent

        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);

        // Luminance formula
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

        // If text is light → dark caret, if text is dark → light caret
        return luminance > 0.5 ? "#1a1a2e" : "#e0e0ff";
    } catch {
        return "#6366F1";
    }
}
