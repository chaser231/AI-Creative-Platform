"use client";

/**
 * RefAutocompleteTextarea
 *
 * A textarea with @ref autocomplete. When the user types "@", a dropdown
 * appears showing available reference images with thumbnails.
 * Selecting one inserts the full @refN tag at the cursor position.
 */

import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
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
}

export interface RefAutocompleteTextareaHandle {
    /** Insert text at current cursor position */
    insertAtCursor: (text: string) => void;
    /** Focus the textarea */
    focus: () => void;
}

export const RefAutocompleteTextarea = forwardRef<RefAutocompleteTextareaHandle, RefAutocompleteTextareaProps>(
    function RefAutocompleteTextarea(
        { value, onChange, referenceImages, placeholder, className, disabled, onKeyDown, rows },
        ref
    ) {
        const textareaRef = useRef<HTMLTextAreaElement>(null);
        const dropdownRef = useRef<HTMLDivElement>(null);
        const [showDropdown, setShowDropdown] = useState(false);
        const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
        const [activeIndex, setActiveIndex] = useState(0);
        const [matchStart, setMatchStart] = useState(-1);
        const [filterText, setFilterText] = useState("");

        // Build list of available refs
        const refOptions = referenceImages.map((src, i) => ({
            tag: getRefTag(i),
            src,
            index: i,
        }));

        // Filter by typed text after @
        const filteredOptions = refOptions.filter(opt =>
            opt.tag.toLowerCase().includes(`@${filterText}`.toLowerCase())
        );

        // Expose insertAtCursor to parent
        useImperativeHandle(ref, () => ({
            insertAtCursor: (text: string) => {
                const ta = textareaRef.current;
                if (!ta) return;
                const start = ta.selectionStart ?? value.length;
                const before = value.slice(0, start);
                const after = value.slice(start);
                // Add space before if needed
                const needsSpace = before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n");
                const insert = (needsSpace ? " " : "") + text + " ";
                const newValue = before + insert + after;
                onChange(newValue);
                // Set cursor after inserted text
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

        // Compute dropdown position relative to textarea
        const computeDropdownPosition = useCallback(() => {
            const ta = textareaRef.current;
            if (!ta) return;

            // Use a mirror div to measure cursor position
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

            // Position dropdown below the cursor line
            setDropdownPos({
                top: Math.min(relativeTop + 22, taRect.height),
                left: Math.min(relativeLeft, taRect.width - 200),
            });
        }, [value]);

        // Handle input changes to detect @ trigger
        const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
            const newValue = e.target.value;
            onChange(newValue);

            const cursorPos = e.target.selectionStart;
            const textBeforeCursor = newValue.slice(0, cursorPos);

            // Find the last @ before cursor that isn't preceded by a word char
            const atMatch = textBeforeCursor.match(/(^|[\s])@(\w*)$/);

            if (atMatch && referenceImages.length > 0) {
                const filter = atMatch[2] || "";
                setFilterText(filter);
                setMatchStart(cursorPos - filter.length - 1); // position of @
                setShowDropdown(true);
                setActiveIndex(0);
                requestAnimationFrame(computeDropdownPosition);
            } else {
                setShowDropdown(false);
            }
        }, [onChange, referenceImages.length, computeDropdownPosition]);

        // Insert selected ref tag
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

        // Keyboard navigation in dropdown
        const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (showDropdown && filteredOptions.length > 0) {
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveIndex(prev => (prev + 1) % filteredOptions.length);
                    return;
                }
                if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveIndex(prev => (prev - 1 + filteredOptions.length) % filteredOptions.length);
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

        // Close dropdown on click outside
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

                {/* Autocomplete dropdown */}
                {showDropdown && filteredOptions.length > 0 && (
                    <div
                        ref={dropdownRef}
                        className="absolute z-50 bg-bg-surface border border-border-primary rounded-xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150"
                        style={{
                            top: dropdownPos.top,
                            left: Math.max(0, dropdownPos.left),
                            minWidth: 180,
                            maxWidth: 260,
                        }}
                    >
                        {filteredOptions.map((opt, i) => (
                            <button
                                key={opt.tag}
                                onMouseDown={(e) => {
                                    e.preventDefault(); // prevent textarea blur
                                    insertRef(opt.tag);
                                }}
                                onMouseEnter={() => setActiveIndex(i)}
                                className={`flex items-center gap-2.5 w-full px-3 py-2 text-left text-sm transition-colors cursor-pointer ${
                                    i === activeIndex
                                        ? "bg-accent-primary/10 text-accent-primary"
                                        : "text-text-primary hover:bg-bg-tertiary"
                                }`}
                            >
                                <img
                                    src={opt.src}
                                    alt={opt.tag}
                                    className="w-7 h-7 rounded-md object-cover border border-border-primary flex-shrink-0"
                                />
                                <span className="font-mono text-xs font-semibold">{opt.tag}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    }
);
