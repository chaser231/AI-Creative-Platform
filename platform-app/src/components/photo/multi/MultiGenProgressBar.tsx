"use client";

interface MultiGenProgressBarProps {
    total: number;
    completed: number;
    failed: number;
    status: string;
}

const STATUS_LABEL: Record<string, string> = {
    DRAFT: "Черновик",
    RUNNING: "Генерация",
    PAUSED: "Пауза",
    COMPLETED: "Завершено",
    FAILED: "Ошибка",
    CANCELLED: "Отменено",
};

export function MultiGenProgressBar({
    total,
    completed,
    failed,
    status,
}: MultiGenProgressBarProps) {
    const safeTotal = Math.max(total, 1);
    const donePct = (completed / safeTotal) * 100;
    const failPct = (failed / safeTotal) * 100;

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-text-secondary">
                    {STATUS_LABEL[status] ?? status}
                </span>
                <span className="text-text-tertiary">
                    {completed}/{total} готово
                    {failed > 0 ? ` · ${failed} ошибок` : ""}
                </span>
            </div>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
                <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${donePct}%` }}
                />
                <div
                    className="h-full bg-red-400 transition-all"
                    style={{ width: `${failPct}%` }}
                />
            </div>
        </div>
    );
}
