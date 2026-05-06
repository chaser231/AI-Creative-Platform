"use client";

/**
 * TabLeaderBadge
 *
 * Small UI affordance shown in the editor TopBar when this tab is NOT the
 * autosave leader for the current project (another tab of the same project
 * is open and currently owns the lock). Clicking "Сделать активной" asks the
 * leader to release the lock so this tab can take over.
 *
 * Hidden when this tab is the leader (the default for single-tab usage).
 */

import { Lock } from "lucide-react";

interface TabLeaderBadgeProps {
    isLeader: boolean;
    isReady: boolean;
    onTakeOver: () => void;
}

export function TabLeaderBadge({ isLeader, isReady, onTakeOver }: TabLeaderBadgeProps) {
    if (!isReady) return null;
    if (isLeader) return null;

    return (
        <div
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-full)] bg-amber-500/10 border border-amber-500/30"
            title="Этот проект уже открыт в другой вкладке. Сохранение отключено в этой вкладке, чтобы избежать конфликтов."
        >
            <Lock size={10} className="text-amber-400" />
            <span className="text-[10px] font-medium text-amber-400">
                Редактирует другая вкладка
            </span>
            <button
                type="button"
                onClick={onTakeOver}
                className="text-[10px] font-semibold text-amber-300 hover:text-amber-200 underline underline-offset-2 cursor-pointer"
            >
                Сделать активной
            </button>
        </div>
    );
}
