"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { TextLayer } from "@/types";
import Konva from "konva";

/**
 * InlineTextEditor — Figma-like inline text editing overlay.
 *
 * Key behaviours:
 * - Transparent background so the canvas context (colors, images) shows through
 * - Real-time text sync: every keystroke updates the store via onUpdate
 * - Automatic container resize based on textAdjust mode
 * - Click outside / Escape → commit; Enter → newline (no submit on enter)
 * - Escape → revert to original text
 * - Contrast-aware caret using inverted text color
 */
export function InlineTextEditor({
    layer,
    stageRef,
    zoom,
    stageX,
    stageY,
    onCommit,
    onUpdate,
}: {
    layer: TextLayer;
    stageRef: React.RefObject<Konva.Stage | null>;
    zoom: number;
    stageX: number;
    stageY: number;
    /** Called on final commit (blur / Escape with original text) */
    onCommit: (text: string) => void;
    /** Called on every keystroke for real-time canvas sync */
    onUpdate?: (text: string) => void;
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [value, setValue] = useState(layer.text);
    const originalText = useRef(layer.text);
    const isCommitted = useRef(false);

    // Calculate the screen position of the text layer
    const screenX = layer.x * zoom + stageX;
    const screenY = layer.y * zoom + stageY;
    const fontSizeScaled = layer.fontSize * zoom;
    const letterSpacingScaled = layer.letterSpacing * zoom;

    // Determine caret color — invert the text fill for contrast
    const caretColor = getContrastColor(layer.fill);

    // Auto-focus and select all text on mount
    useEffect(() => {
        const ta = textareaRef.current;
        if (ta) {
            ta.focus();
            ta.select();
        }
    }, []);

    // Commit handler — only runs once per editing session
    const doCommit = useCallback((text: string) => {
        if (isCommitted.current) return;
        isCommitted.current = true;
        onCommit(text);
    }, [onCommit]);

    // Handle text changes — real-time sync
    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newText = e.target.value;
        setValue(newText);
        onUpdate?.(newText);
    }, [onUpdate]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            // Revert to original text
            onUpdate?.(originalText.current);
            doCommit(originalText.current);
        }
        // Enter = newline (default textarea behavior, no preventDefault)
        // Tab = commit and move focus
        if (e.key === "Tab") {
            e.preventDefault();
            doCommit(value);
        }
    }, [doCommit, value, onUpdate]);

    const handleBlur = useCallback(() => {
        doCommit(value);
    }, [doCommit, value]);

    // Compute dynamic dimensions based on textAdjust mode
    const isAutoWidth = layer.textAdjust === "auto_width";
    const isAutoHeight = layer.textAdjust === "auto_height" || !layer.textAdjust;

    // Minimum width to prevent collapse
    const minScreenW = Math.max(layer.width * zoom, 20);

    return (
        <div
            ref={containerRef}
            style={{
                position: "absolute",
                left: screenX,
                top: screenY,
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

                    // Sizing based on textAdjust mode
                    width: isAutoWidth ? "max-content" : minScreenW,
                    minWidth: isAutoWidth ? 20 : minScreenW,
                    maxWidth: isAutoWidth ? "none" : minScreenW,
                    height: isAutoHeight || isAutoWidth ? "auto" : Math.max(layer.height * zoom, 20),
                    minHeight: isAutoHeight || isAutoWidth ? fontSizeScaled * layer.lineHeight : Math.max(layer.height * zoom, 20),

                    // Prevent text selection styling from obscuring content
                    WebkitTextFillColor: layer.fillEnabled === false ? "transparent" : layer.fill,
                }}
            />
            {/* Subtle editing indicator border */}
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
