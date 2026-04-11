"use client";

/**
 * CreateWorkspaceModal
 *
 * Modal for creating a new workspace with name, slug, BU, visibility, and join policy.
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { X, Loader2, Globe, Lock, Users, ShieldCheck } from "lucide-react";
import { Select } from "@/components/ui/Select";

const BU_OPTIONS = [
    { value: "yandex-market", label: "Яндекс Маркет" },
    { value: "yandex-go", label: "Яндекс Go" },
    { value: "yandex-food", label: "Яндекс Еда" },
    { value: "yandex-lavka", label: "Яндекс Лавка" },
    { value: "yandex-travel", label: "Яндекс Путешествия" },
    { value: "other", label: "Другое" },
];

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[а-яё]/g, (ch) => {
            const map: Record<string, string> = {
                а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo",
                ж: "zh", з: "z", и: "i", й: "j", к: "k", л: "l", м: "m",
                н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
                ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
                ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
            };
            return map[ch] || ch;
        })
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50);
}

export function CreateWorkspaceModal({ isOpen, onClose }: Props) {
    const { setWorkspaceId, refetch } = useWorkspace();

    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [slugManual, setSlugManual] = useState(false);
    const [businessUnit, setBusinessUnit] = useState("other");
    const [visibility, setVisibility] = useState<"VISIBLE" | "HIDDEN">("VISIBLE");
    const [joinPolicy, setJoinPolicy] = useState<"OPEN" | "REQUEST" | "INVITE_ONLY">("OPEN");

    // Auto-generate slug from name
    useEffect(() => {
        if (!slugManual && name) {
            setSlug(slugify(name));
        }
    }, [name, slugManual]);

    const createMutation = trpc.workspace.create.useMutation({
        onSuccess: (workspace: { id: string }) => {
            refetch();
            setWorkspaceId(workspace.id);
            onClose();
            // Reset form
            setName("");
            setSlug("");
            setSlugManual(false);
            setBusinessUnit("other");
            setVisibility("VISIBLE");
            setJoinPolicy("OPEN");
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !slug.trim()) return;
        createMutation.mutate({ name, slug, businessUnit, visibility, joinPolicy });
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

            <div className="relative w-full max-w-md mx-4 bg-bg-surface border border-border-primary rounded-[var(--radius-2xl)] shadow-[var(--shadow-lg)] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary">
                    <div>
                        <h2 className="text-base font-semibold text-text-primary">Новая команда</h2>
                        <p className="text-xs text-text-tertiary mt-0.5">
                            Создайте воркспейс для вашей команды
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-[var(--radius-md)] hover:bg-bg-secondary text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {/* Name */}
                    <div>
                        <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                            Название
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Моя команда"
                            className="w-full h-10 px-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-focus"
                            autoFocus
                            required
                        />
                    </div>

                    {/* Slug */}
                    <div>
                        <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                            URL-идентификатор
                        </label>
                        <div className="flex items-center gap-1">
                            <span className="text-[10px] text-text-tertiary shrink-0">/invite/</span>
                            <input
                                type="text"
                                value={slug}
                                onChange={(e) => {
                                    setSlug(e.target.value.replace(/[^a-z0-9-]/g, ""));
                                    setSlugManual(true);
                                }}
                                placeholder="my-team"
                                pattern="[a-z0-9-]+"
                                className="flex-1 h-10 px-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-focus font-mono"
                                required
                            />
                        </div>
                    </div>

                    {/* BU */}
                    <div>
                        <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                            Бизнес-юнит
                        </label>
                        <Select
                            value={businessUnit}
                            onChange={(val) => setBusinessUnit(val)}
                            options={BU_OPTIONS.map((bu) => ({ value: bu.value, label: bu.label }))}
                        />
                    </div>

                    {/* Visibility + Join Policy row */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                                Видимость
                            </label>
                            <div className="flex rounded-[var(--radius-lg)] border border-border-primary overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setVisibility("VISIBLE")}
                                    className={`flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors cursor-pointer ${
                                        visibility === "VISIBLE"
                                            ? "bg-accent-primary/10 text-accent-primary"
                                            : "text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary"
                                    }`}
                                >
                                    <Globe size={10} /> Видима
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setVisibility("HIDDEN")}
                                    className={`flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors cursor-pointer border-l border-border-primary ${
                                        visibility === "HIDDEN"
                                            ? "bg-accent-primary/10 text-accent-primary"
                                            : "text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary"
                                    }`}
                                >
                                    <Lock size={10} /> Скрыта
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                                Вступление
                            </label>
                            <Select
                                size="sm"
                                value={joinPolicy}
                                onChange={(val) => setJoinPolicy(val as any)}
                                options={[
                                    { value: "OPEN", label: "Свободное" },
                                    { value: "REQUEST", label: "По заявке" },
                                    { value: "INVITE_ONLY", label: "По приглашению" },
                                ]}
                            />
                        </div>
                    </div>

                    {/* Error */}
                    {createMutation.error && (
                        <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-[var(--radius-md)]">
                            {createMutation.error.message}
                        </p>
                    )}

                    {/* Submit */}
                    <button
                        type="submit"
                        disabled={createMutation.isPending || !name.trim() || !slug.trim()}
                        className="w-full h-10 flex items-center justify-center gap-2 bg-accent-primary text-white rounded-[var(--radius-lg)] text-sm font-medium hover:bg-accent-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        {createMutation.isPending ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            "Создать команду"
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}
