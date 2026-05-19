import { Loader2, Image as ImageIcon } from "lucide-react";

export interface GeneratedImageVariant {
    id: string;
    url?: string;
    status?: "loading" | "ready" | "error";
    /** Short prompt hint shown on loading/error thumbnails */
    promptLabel?: string;
}

interface GeneratedImageStripProps {
    variants: GeneratedImageVariant[];
    selectedId?: string;
    onSelect?: (variant: GeneratedImageVariant, index: number) => void;
    label?: string;
    className?: string;
}

export function GeneratedImageStrip({
    variants,
    selectedId,
    onSelect,
    label = "Варианты генерации",
    className = "",
}: GeneratedImageStripProps) {
    if (variants.length === 0) return null;

    return (
        <div
            className={`flex max-w-[min(520px,92vw)] items-center justify-center gap-3 overflow-x-auto rounded-[18px] border border-border-primary/70 bg-bg-primary/85 px-3 py-2 shadow-lg backdrop-blur-md [scrollbar-width:thin] ${className}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <span className="sr-only">{label}</span>
            {variants.map((variant, index) => {
                const status = variant.status ?? (variant.url ? "ready" : "loading");
                const selected = selectedId === variant.id;
                const disabled = status !== "ready" || !variant.url;
                const title = variant.promptLabel?.trim() || label;

                return (
                    <button
                        key={variant.id}
                        type="button"
                        disabled={disabled}
                        title={title}
                        aria-label={`${label}: вариант ${index + 1}`}
                        aria-pressed={selected}
                        onClick={() => onSelect?.(variant, index)}
                        className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-[12px] border-2 bg-bg-secondary transition-all disabled:cursor-wait ${
                            selected
                                ? "border-accent-lime-hover ring-2 ring-accent-lime/50"
                                : "border-border-primary hover:border-border-secondary"
                        }`}
                    >
                        {status === "ready" && variant.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={variant.url}
                                alt=""
                                className="h-full w-full object-cover"
                                draggable={false}
                            />
                        ) : status === "error" ? (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-red-500/10 px-0.5 text-red-400">
                                <ImageIcon size={16} />
                                {variant.promptLabel && (
                                    <span className="max-w-full truncate text-[8px] leading-tight">
                                        {variant.promptLabel}
                                    </span>
                                )}
                            </div>
                        ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-bg-tertiary px-0.5 text-text-tertiary">
                                <Loader2 size={16} className="animate-spin" />
                                {variant.promptLabel && (
                                    <span className="max-w-full truncate text-[8px] leading-tight text-text-tertiary">
                                        {variant.promptLabel}
                                    </span>
                                )}
                            </div>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
