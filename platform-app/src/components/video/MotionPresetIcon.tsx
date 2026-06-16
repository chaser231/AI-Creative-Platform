"use client";

import {
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ChevronsUp,
    Focus,
    Lock,
    Minus,
    Plane,
    RotateCw,
    Smartphone,
    Zap,
    ZoomIn,
    ZoomOut,
    type LucideIcon,
} from "lucide-react";
import type { MotionPresetIconName } from "@/lib/video-presets";

const ICON_MAP: Record<MotionPresetIconName, LucideIcon> = {
    lock: Lock,
    "zoom-in": ZoomIn,
    "zoom-out": ZoomOut,
    zap: Zap,
    "rotate-cw": RotateCw,
    "arrow-left": ArrowLeft,
    "arrow-right": ArrowRight,
    "arrow-up": ArrowUp,
    smartphone: Smartphone,
    plane: Plane,
    focus: Focus,
    "chevrons-up": ChevronsUp,
};

interface MotionPresetIconProps {
    name: MotionPresetIconName | "auto";
    size?: number;
    className?: string;
    strokeWidth?: number;
}

/** Renders a Lucide icon for a camera motion preset (or "auto" = minus). */
export function MotionPresetIcon({
    name,
    size = 14,
    className,
    strokeWidth = 1.75,
}: MotionPresetIconProps) {
    const Icon = name === "auto" ? Minus : ICON_MAP[name];
    return <Icon size={size} strokeWidth={strokeWidth} className={className} aria-hidden />;
}
