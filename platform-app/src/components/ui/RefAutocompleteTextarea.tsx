"use client";

/**
 * RefAutocompleteTextarea
 *
 * A textarea with @ref autocomplete. When the user types "@", a dropdown
 * appears showing available reference images with thumbnails.
 * Selecting one inserts the full @refN tag at the cursor position.
 */

import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle, type CSSProperties } from "react";
import { getRefTag } from "@/components/ui/ReferenceImageInput";

export interface RefAutocompleteTextareaProps {
    value: string;
    onChange: (value: string) => void;
    /** Array of reference image data URIs / URLs */
    referenceImages: string[];
    placeholder?: string;
    className?: string;
    disabled?: boolean;
    onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    rows?: number;
    /** Prefer opening the @ref list above the cursor (auto picks based on viewport space). */
    dropdownPlacement?: "above" | "below" | "auto";
}

export interface RefAutocompleteTextareaHandle {
    /** Insert text at current cursor position */
    insertAtCursor: (text: string) => void;
    /** Focus the textarea */
    focus: () => void;
}

const DROPDOWN_GAP = 6;
const DROPDOWN_EST_HEIGHT = 200;

export const RefAutocompleteTextarea = forwardRef<RefAutocompleteTextareaHandle, RefAutocompleteTextareaProps>(
    function RefAutocompleteTextarea(
        {
            value,
            onChange,
            referenceImages,
            placeholder,
            className,
            disabled,
            onKeyDown,
            rows,
            dropdownPlacement = "auto",
        },
        ref
    ) {
        const textareaRef = useRef<HTMLTextAreaElement>(null);
        const dropdownRef = useRef<HTMLDivElement>(null);
        const [showDropdown, setShowDropdown] = useState(false);
        const [dropdownPos, setDropdownPos] = useState<{
            top?: number;
            bottom?: number;
            left: number;
            placement: "above" | "below";
        }>({ left: 0, placement: "below" });
        const [activeIndex, setActiveIndex] = useState(0);
        const [matchStart, setMatchStart] = useState(-1);
        const [filterText, setFilterText] = useState("");

        const refOptions = referenceImages.map((src, i) => ({
            tag: getRefTag(i),
            src,
            index: i,
        }));

        const filteredOptions = refOptions.filter((opt) =>
            opt.tag.toLowerCase().includes(`@${filterText}`.toLowerCase()),
        );

        useImperativeHandle(ref, () => ({
            insertAtCursor: (text: string) => {
                const ta = textareaRef.current;
                if (!ta) return;
                const start = ta.selectionStart ?? value.length;
                const before = value.slice(0, start);
                const after = value.slice(start);
                const needsSpace = before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n");
                const insert = (needsSpace ? " " : "") + text + " ";
                const newValue = before + insert + after;
                onChange(newValue);
                requestAnimationFrame(() => {
                    if (ta) {
                        const newPos = start + insert.length;
                        ta.selectionStart = newPos;
                        ta.selectionEnd = newPos;
                        ta.focus();
                    }
                });
            },
            focus: () => textareaRef.current?.focus(),
        }));

        const computeDropdownPosition = useCallback(() => {
            const ta = textareaRef.current;
            if (!ta) return;

            const mirror = document.createElement("div");
            const style = window.getComputedStyle(ta);
            mirror.style.cssText = `
                position: absolute; visibility: hidden; white-space: pre-wrap;
                word-wrap: break-word; overflow: hidden;
                font: ${style.font}; padding: ${style.padding};
                width: ${style.width}; line-height: ${style.lineHeight};
                letter-spacing: ${style.letterSpacing};
            `;
            const textBefore = value.slice(0, ta.selectionStart);
            mirror.textContent = textBefore;
            const marker = document.createElement("span");
            marker.textContent = "|";
            mirror.appendChild(marker);
            document.body.appendChild(mirror);

            const taRect = ta.getBoundingClientRect();
            const markerRect = marker.getBoundingClientRect();
            const mirrorRect = mirror.getBoundingClientRect();

            const relativeTop = markerRect.top - mirrorRect.top - ta.scrollTop;
            const relativeLeft = markerRect.left - mirrorRect.left;

            document.body.removeChild(mirror);

            const spaceBelow = taRect.bottom - markerRect.bottom;
            const spaceAbove = markerRect.top - taRect.top;
            let placement: "above" | "below" = "below";
            if (dropdownPlacement === "above") {
                placement = "above";
            } else if (dropdownPlacement === "below") {
                placement = "below";
            } else {
                placement = spaceBelow < DROPDOWN_EST_HEIGHT && spaceAbove > spaceBelow ? "above" : "below";
            }

            const left = Math.min(Math.max(0, relativeLeft), ta.clientWidth - 200);
            if (placement === "above") {
                setDropdownPos({
                    bottom: ta.clientHeight - relativeTop + DROPDOWN_GAP,
                    left,
                    placement: "above",
                });
            } else {
                setDropdownPos({
                    top: Math.min(relativeTop + 22, ta.clientHeight),
                    left,
                    placement: "below",
                });
            }
        }, [value, dropdownPlacement]);

        const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
            const newValue = e.target.value;
            onChange(newValue);

            const cursorPos = e.target.selectionStart;
            const textBeforeCursor = newValue.slice(0, cursorPos);
            const atMatch = textBeforeCursor.match(/(^|[\s])@(\w*)$/);

            if (atMatch && referenceImages.length > 0) {
                const filter = atMatch[2] || "";
                setFilterText(filter);
                setMatchStart(cursorPos - filter.length - 1);
                setShowDropdown(true);
                setActiveIndex(0);
                requestAnimationFrame(computeDropdownPosition);
            } else {
                setShowDropdown(false);
            }
        }, [onChange, referenceImages.length, computeDropdownPosition]);

        const insertRef = useCallback((tag: string) => {
            if (matchStart < 0) return;
            const ta = textareaRef.current;
            const cursorPos = ta?.selectionStart ?? value.length;
            const before = value.slice(0, matchStart);
            const after = value.slice(cursorPos);
            const newValue = before + tag + " " + after;
            onChange(newValue);
            setShowDropdown(false);

            requestAnimationFrame(() => {
                if (ta) {
                    const newPos = matchStart + tag.length + 1;
                    ta.selectionStart = newPos;
                    ta.selectionEnd = newPos;
                    ta.focus();
                }
            });
        }, [matchStart, value, onChange]);

        const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (showDropdown && filteredOptions.length > 0) {
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveIndex((prev) => (prev + 1) % filteredOptions.length);
                    return;
                }
                if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveIndex((prev) => (prev - 1 + filteredOptions.length) % filteredOptions.length);
                    return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    insertRef(filteredOptions[activeIndex].tag);
                    return;
                }
                if (e.key === "Escape") {
                    setShowDropdown(false);
                    return;
                }
            }
            onKeyDown?.(e);
        }, [showDropdown, filteredOptions, activeIndex, insertRef, onKeyDown]);

        useEffect(() => {
            const handleClickOutside = (e: MouseEvent) => {
                if (
                    dropdownRef.current &&
                    !dropdownRef.current.contains(e.target as Node) &&
                    textareaRef.current &&
                    !textareaRef.current.contains(e.target as Node)
                ) {
                    setShowDropdown(false);
                }
            };
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }, []);

        const dropdownStyle: CSSProperties = {
            left: Math.max(0, dropdownPos.left),
            minWidth: 180,
            maxWidth: 260,
            maxHeight: DROPDOWN_EST_HEIGHT,
            ...(dropdownPos.placement === "above"
                ? { bottom: dropdownPos.bottom }
                : { top: dropdownPos.top }),
        };

        return (
            <div className="relative w-full">
                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    className={className}
                    disabled={disabled}
                    rows={rows}
                />

                {showDropdown && filteredOptions.length > 0 && (
                    <div
                        ref={dropdownRef}
                        className={`absolute z-50 overflow-y-auto rounded-xl border border-border-primary bg-bg-surface shadow-xl animate-in fade-in duration-150 ${
                            dropdownPos.placement === "above"
                                ? "slide-in-from-top-2"
                                : "slide-in-from-bottom-2"
                        }`}
                        style={dropdownStyle}
                    >
                        {filteredOptions.map((opt, i) => (
                            <button
                                key={opt.tag}
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    insertRef(opt.tag);
                                }}
                                onMouseEnter={() => setActiveIndex(i)}
                                className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                                    i === activeIndex
                                        ? "bg-accent-primary/10 text-accent-primary"
                                        : "text-text-primary hover:bg-bg-tertiary"
                                }`}
                            >
                                <img
                                    src={opt.src}
                                    alt={opt.tag}
                                    className="h-7 w-7 flex-shrink-0 rounded-md border border-border-primary object-cover"
                                />
                                <span className="font-mono text-xs font-semibold">{opt.tag}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    },
);
