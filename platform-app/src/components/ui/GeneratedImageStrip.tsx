import { Loader2, Image as ImageIcon } from "lucide-react";

export interface GeneratedImageVariant {
    id: string;
    url?: string;
    status?: "loading" | "ready" | "error";
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
            className={`flex items-center justify-center gap-3 rounded-[18px] border border-border-primary/70 bg-bg-primary/85 px-3 py-2 shadow-lg backdrop-blur-md ${className}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <span className="sr-only">{label}</span>
            {variants.map((variant, index) => {
                const status = variant.status ?? (variant.url ? "ready" : "loading");
                const selected = selectedId === variant.id;
                const disabled = status !== "ready" || !variant.url;

                return (
                    <button
                        key={variant.id}
                        type="button"
                        disabled={disabled}
                        aria-label={`${label}: вариант ${index + 1}`}
                        aria-pressed={selected}
                        onClick={() => onSelect?.(variant, index)}
                        className={`relative h-14 w-14 overflow-hidden rounded-[12px] border-2 bg-bg-secondary transition-all disabled:cursor-wait ${
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
                            <div className="flex h-full w-full items-center justify-center bg-red-500/10 text-red-400">
                                <ImageIcon size={18} />
                            </div>
                        ) : (
                            <div className="flex h-full w-full items-center justify-center bg-bg-tertiary text-text-tertiary">
                                <Loader2 size={18} className="animate-spin" />
                            </div>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
