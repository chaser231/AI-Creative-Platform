const MAX_MESSAGE_LENGTH = 280;

function normalizeMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error ?? "");
}

function includesAny(haystack: string, needles: string[]): boolean {
    const lower = haystack.toLowerCase();
    return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

/**
 * Maps provider / network errors to user-facing Russian messages.
 */
export function parseGenerationError(error: unknown): string {
    const msg = normalizeMessage(error);
    if (!msg) return "Ошибка генерации";

    if (includesAny(msg, ["429", "rate limit", "too many requests"])) {
        return "Слишком много запросов. Подождите 10–15 секунд и попробуйте снова.";
    }

    if (
        includesAny(msg, [
            "capacity",
            "concurrent",
            "queue is full",
            "overloaded",
            "overload",
            "at capacity",
        ])
    ) {
        return "Сервис генерации перегружен. Запрос будет повторён автоматически или попробуйте через минуту.";
    }

    if (includesAny(msg, ["e003", "high demand", "fetch failed", "polling failed"])) {
        return "Слишком много запросов. Подождите 10–15 секунд и попробуйте снова.";
    }

    if (includesAny(msg, ["timed out", "timeout", "abort"])) {
        return "Генерация заняла слишком много времени. Попробуйте снова или выберите более быструю модель.";
    }

    if (msg.length > MAX_MESSAGE_LENGTH) {
        return `${msg.slice(0, MAX_MESSAGE_LENGTH)}…`;
    }

    return msg;
}

/** Whether a failed run should be retried inside the same queue slot. */
export function isRetryableGenerationError(error: unknown): boolean {
    const msg = normalizeMessage(error).toLowerCase();
    return (
        msg.includes("429")
        || msg.includes("rate limit")
        || msg.includes("too many requests")
        || msg.includes("capacity")
        || msg.includes("concurrent")
        || msg.includes("queue is full")
        || msg.includes("overloaded")
        || msg.includes("overload")
        || msg.includes("e003")
        || msg.includes("high demand")
        || msg.includes("fetch failed")
    );
}
