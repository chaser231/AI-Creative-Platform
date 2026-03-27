"use client";

import { useRef, useState, useEffect } from "react";
import type { TextLayer } from "@/types";
import Konva from "konva";

export function InlineTextEditor({
    layer,
    stageRef,
    zoom,
    stageX,
    stageY,
    onCommit,
}: {
    layer: TextLayer;
    stageRef: React.RefObject<Konva.Stage | null>;
    zoom: number;
    stageX: number;
    stageY: number;
    onCommit: (text: string) => void;
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [value, setValue] = useState(layer.text);

    // Calculate the screen position of the text layer
    const screenX = layer.x * zoom + stageX;
    const screenY = layer.y * zoom + stageY;
    const screenW = layer.width * zoom;
    const screenH = Math.max(layer.height * zoom, 40);

    useEffect(() => {
        const ta = textareaRef.current;
        if (ta) {
            ta.focus();
            ta.select();
        }
    }, []);

    const handleCommit = () => {
        onCommit(value);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            onCommit(layer.text);
        }
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleCommit();
        }
    };

    const fontSizeScaled = layer.fontSize * zoom;

    return (
        <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleCommit}
            onKeyDown={handleKeyDown}
            style={{
                position: "absolute",
                left: screenX,
                top: screenY,
                width: screenW,
                minHeight: screenH,
                fontSize: fontSizeScaled,
                fontFamily: layer.fontFamily,
                fontWeight: layer.fontWeight,
                color: layer.fill,
                textAlign: layer.align,
                textTransform: layer.textTransform === "uppercase" ? "uppercase" : layer.textTransform === "lowercase" ? "lowercase" : "none",
                letterSpacing: layer.letterSpacing * zoom,
                lineHeight: layer.lineHeight,
                border: "2px solid var(--accent-primary)",
                borderRadius: "var(--radius-sm)",
                background: "rgba(255,255,255,0.95)",
                padding: "2px 4px",
                margin: 0,
                outline: "none",
                resize: "none",
                overflow: "hidden",
                zIndex: 50,
                transformOrigin: "top left",
                transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
                boxShadow: "0 0 0 3px rgba(99, 102, 241, 0.2)",
            }}
        />
    );
}
