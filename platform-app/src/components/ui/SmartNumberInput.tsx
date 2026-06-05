"use client";

import { useCallback, useRef, useState } from "react";

function clampNumber(value: number, min?: number, max?: number) {
    return Math.max(min ?? -Infinity, Math.min(max ?? Infinity, value));
}

function precisionForStep(step: number) {
    const [, decimals = ""] = String(step).split(".");
    return Math.min(4, Math.max(0, decimals.length));
}

function roundToStep(value: number, step: number) {
    const precision = precisionForStep(step);
    return Number(value.toFixed(Math.max(precision, 2)));
}

export function useNumberScrub({
    value,
    onChange,
    min,
    max,
    step = 1,
}: {
    value: number;
    onChange: (val: number) => void;
    min?: number;
    max?: number;
    step?: number;
}) {
    const dragRef = useRef<{ pointerId: number; startX: number; startValue: number } | null>(null);
    // Coalesce pointermove → onChange to one call per animation frame so a scrub
    // doesn't fire a full store update (and layout/re-render) on every pixel.
    const rafRef = useRef<number | null>(null);
    const pendingRef = useRef<number | null>(null);

    const flush = useCallback(() => {
        rafRef.current = null;
        if (pendingRef.current !== null) {
            onChange(pendingRef.current);
            pendingRef.current = null;
        }
    }, [onChange]);

    const cancelRaf = useCallback(() => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
    }, []);

    const applyDelta = useCallback((event: React.PointerEvent<HTMLElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
        const next = drag.startValue + (event.clientX - drag.startX) * step * multiplier;
        pendingRef.current = roundToStep(clampNumber(next, min, max), step);
        if (rafRef.current === null) {
            rafRef.current = requestAnimationFrame(flush);
        }
    }, [max, min, step, flush]);

    return {
        onPointerDown: useCallback((event: React.PointerEvent<HTMLElement>) => {
            if (event.button !== 0) return;
            event.preventDefault();
            dragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startValue: value,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
        }, [value]),
        onPointerMove: useCallback((event: React.PointerEvent<HTMLElement>) => {
            applyDelta(event);
        }, [applyDelta]),
        onPointerUp: useCallback((event: React.PointerEvent<HTMLElement>) => {
            if (dragRef.current?.pointerId !== event.pointerId) return;
            applyDelta(event);
            cancelRaf();
            flush(); // commit the final value synchronously
            dragRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
        }, [applyDelta, cancelRaf, flush]),
        onPointerCancel: useCallback((event: React.PointerEvent<HTMLElement>) => {
            if (dragRef.current?.pointerId !== event.pointerId) return;
            cancelRaf();
            pendingRef.current = null;
            dragRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
        }, [cancelRaf]),
    };
}

export function SmartNumberInput({
    value,
    onChange,
    className,
    min,
    max,
    step = 1,
}: {
    value: number;
    onChange: (val: number) => void;
    className?: string;
    min?: number;
    max?: number;
    step?: number;
}) {
    const formatValue = (v: number) => (Number.isInteger(v) ? String(v) : Number(v.toFixed(2)).toString());
    const [localValue, setLocalValue] = useState(formatValue(value));
    const [isFocused, setIsFocused] = useState(false);
    const displayValue = isFocused ? localValue : formatValue(value);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setLocalValue(val);
        if (val !== "" && val !== "-") {
            let num = Number(val);
            if (!isNaN(num)) {
                // Don't clamp on change, clamp on blur so user can type freely
                onChange(num);
            }
        }
    };

    const handleBlur = () => {
        setIsFocused(false);
        if (localValue === "" || localValue === "-") {
            // Revert
            setLocalValue(formatValue(value));
        } else {
            let num = Number(localValue);
            if (!isNaN(num)) {
                if (min !== undefined) num = Math.max(min, num);
                if (max !== undefined) num = Math.min(max, num);
                onChange(num);
                setLocalValue(formatValue(num));
            } else {
                setLocalValue(formatValue(value));
            }
        }
    };

    const commitStep = (direction: 1 | -1, multiplier = 1) => {
        const next = clampNumber(value + direction * step * multiplier, min, max);
        onChange(roundToStep(next, step));
    };

    return (
        <input
            type="text"
            inputMode="decimal"
            value={displayValue}
            onFocus={() => {
                setLocalValue(formatValue(value));
                setIsFocused(true);
            }}
            onBlur={handleBlur}
            onChange={handleChange}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.currentTarget.blur();
                } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    commitStep(1, e.shiftKey ? 10 : 1);
                } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    commitStep(-1, e.shiftKey ? 10 : 1);
                }
            }}
            className={className}
        />
    );
}
