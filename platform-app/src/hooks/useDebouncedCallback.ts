"use client";

import { useCallback, useEffect, useRef } from "react";

export const DEBOUNCED_COMMIT_MS = 150;

export function useDebouncedCallback<T>(
    callback: (value: T) => void,
    delayMs = DEBOUNCED_COMMIT_MS,
) {
    const callbackRef = useRef(callback);
    callbackRef.current = callback;

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRef = useRef<T | null>(null);

    const flush = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        if (pendingRef.current !== null) {
            callbackRef.current(pendingRef.current);
            pendingRef.current = null;
        }
    }, []);

    const schedule = useCallback((value: T) => {
        pendingRef.current = value;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(flush, delayMs);
    }, [flush, delayMs]);

    useEffect(() => () => { flush(); }, [flush]);

    return { schedule, flush };
}
