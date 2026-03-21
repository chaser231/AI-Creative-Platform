"use client";

import { cn } from "@/lib/cn";

type BadgeStatus = "draft" | "in-progress" | "review" | "published";

interface BadgeProps {
    status: BadgeStatus;
    className?: string;
}

const statusConfig: Record<BadgeStatus, { label: string; classes: string }> = {
    draft: {
        label: "Черновик",
        classes: "bg-amber-100 text-amber-700",
    },
    "in-progress": {
        label: "В работе",
        classes: "bg-blue-100 text-blue-700",
    },
    review: {
        label: "На ревью",
        classes: "bg-violet-100 text-violet-700",
    },
    published: {
        label: "Опубликован",
        classes: "bg-emerald-100 text-emerald-700",
    },
};

export function Badge({ status, className }: BadgeProps) {
    // Normalize: DB may return "DRAFT", "IN_PROGRESS" etc.
    const normalized = status.toLowerCase().replace(/_/g, "-") as BadgeStatus;
    const config = statusConfig[normalized] ?? statusConfig.draft;
    return (
        <span
            className={cn(
                "inline-flex items-center px-2.5 py-0.5 rounded-[var(--radius-full)] text-[11px] font-semibold tracking-wide",
                config.classes,
                className
            )}
        >
            {config.label}
        </span>
    );
}
