"use client";

import { useState, useEffect, useCallback } from "react";
import { isFocusedOnInput } from "@/utils/keyboard";
import Konva from "konva";

interface UsePanZoomOptions {
    stageRef: React.RefObject<Konva.Stage | null>;
    containerRef: React.RefObject<HTMLDivElement | null>;
    zoom: number;
    stageX: number;
    stageY: number;
    setZoom: (z: number) => void;
    setStagePosition: (x: number, y: number) => void;
    isEditingText: boolean;
    setStageDraggable: (d: boolean) => void;
}

export function usePanZoom({
    stageRef,
    containerRef,
    zoom,
    stageX,
    stageY,
    setZoom,
    setStagePosition,
    isEditingText,
    setStageDraggable,
}: UsePanZoomOptions) {
    const [isPanning, setIsPanning] = useState(false);

    // Spacebar Panning Logic
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isFocusedOnInput(e)) return;

            // Space to pan
            if (e.code === "Space" && !isEditingText && !isPanning) {
                e.preventDefault(); // Prevent scrolling
                setIsPanning(true);
                // Ensure stage is draggable
                setStageDraggable(true);
                if (containerRef.current) {
                    containerRef.current.style.cursor = "grab";
                }
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (isFocusedOnInput(e)) return;

            if (e.code === "Space" && isPanning) {
                setIsPanning(false);
                if (containerRef.current) {
                    containerRef.current.style.cursor = "default";
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, [isEditingText, isPanning, setStageDraggable, containerRef]);

    const handleWheel = useCallback(
        (e: Konva.KonvaEventObject<WheelEvent>) => {
            e.evt.preventDefault();
            const stage = stageRef.current;
            if (!stage) return;

            // Check for Pinch (CtrlKey on standard trackpads) for Zoom
            if (e.evt.ctrlKey) {
                const oldScale = zoom;
                const pointer = stage.getPointerPosition();
                if (!pointer) return;

                const scaleBy = 1.05;
                const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
                const clampedScale = Math.min(Math.max(newScale, 0.1), 3);

                const mousePointTo = {
                    x: (pointer.x - stageX) / oldScale,
                    y: (pointer.y - stageY) / oldScale,
                };

                setZoom(clampedScale);
                setStagePosition(
                    pointer.x - mousePointTo.x * clampedScale,
                    pointer.y - mousePointTo.y * clampedScale
                );
            } else {
                // Pan
                setStagePosition(
                    stageX - e.evt.deltaX,
                    stageY - e.evt.deltaY
                );
            }
        },
        [zoom, stageX, stageY, setZoom, setStagePosition, stageRef]
    );

    return { isPanning, setIsPanning, handleWheel };
}
