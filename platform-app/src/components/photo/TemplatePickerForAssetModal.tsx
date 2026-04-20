"use client";

/**
 * TemplatePickerForAssetModal
 *
 * Two-step picker used by the "В баннер → Из шаблона" action on generated
 * photos / library assets. Unlike opening `TemplatePanel` after the project is
 * already seeded with an image layer (which gets wiped by the destructive
 * template apply), this modal picks the template + slot BEFORE creating the
 * project. It then routes to the editor with:
 *   /editor/{id}?assetId=...&applyTemplate={templateId}&applySlot={slotId}
 * where EditorPage applies the template and injects the asset url as the
 * given slot's contentOverride in a single shot — no wasted layer, no
 * flashing UI.
 *
 * Step 1: browse templates (uses `trpc.template.list`).
 * Step 2: select an image slot inside the chosen template (fetches
 *         `trpc.template.getById` for full `data.layers`, extracts image
 *         layers that have a `slotId`, shows thumbnails of the placeholder
 *         `src`). If there is only one image slot the step is auto-confirmed.
 */

import { useMemo, useState } from "react";
import { Loader2, LayoutTemplate, ArrowLeft, Image as ImageIcon, Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { useCreateBannerFromAsset } from "@/hooks/useCreateBannerFromAsset";

interface TemplatePickerForAssetModalProps {
    open: boolean;
    onClose: () => void;
    /** Source image used as the preview in the slot picker and as the override value. */
    imageUrl: string;
    /** Preferred — pass the Asset id so the final url is resolved on the server. */
    assetId?: string;
}

interface ImageSlotInfo {
    /** slotId — used as the contentOverrides key. */
    slotId: string;
    /** Layer display name from the template layer. */
    name: string;
    /** Current placeholder `src` in the template — shown as a thumbnail. */
    previewSrc?: string;
    /** Layer dimensions so we can hint at aspect ratio. */
    width: number;
    height: number;
}

/** Extract image layers with a `slotId` from the raw template canvas state. */
function extractImageSlots(templateData: unknown): ImageSlotInfo[] {
    if (!templateData || typeof templateData !== "object") return [];
    const data = templateData as { layers?: unknown };
    const layers = Array.isArray(data.layers) ? data.layers : [];
    const slots: ImageSlotInfo[] = [];
    const seen = new Set<string>();
    for (const raw of layers) {
        if (!raw || typeof raw !== "object") continue;
        const l = raw as {
            type?: string;
            slotId?: string;
            src?: string;
            name?: string;
            width?: number;
            height?: number;
            isFixedAsset?: boolean;
        };
        if (l.type !== "image") continue;
        if (!l.slotId || typeof l.slotId !== "string") continue;
        if (l.isFixedAsset) continue;
        if (seen.has(l.slotId)) continue;
        seen.add(l.slotId);
        slots.push({
            slotId: l.slotId,
            name: l.name || l.slotId,
            previewSrc: typeof l.src === "string" ? l.src : undefined,
            width: typeof l.width === "number" ? l.width : 1,
            height: typeof l.height === "number" ? l.height : 1,
        });
    }
    return slots;
}

export function TemplatePickerForAssetModal({
    open,
    onClose,
    imageUrl,
    assetId,
}: TemplatePickerForAssetModalProps) {
    const { currentWorkspace } = useWorkspace();
    const workspaceId = currentWorkspace?.id ?? "";

    const [search, setSearch] = useState("");
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

    const listQuery = trpc.template.list.useQuery(
        { workspaceId, search: search || undefined },
        { enabled: open && !!workspaceId, refetchOnWindowFocus: false },
    );

    const templateQuery = trpc.template.getById.useQuery(
        { id: selectedTemplateId ?? "" },
        {
            enabled: open && !!selectedTemplateId,
            refetchOnWindowFocus: false,
            retry: false,
        },
    );

    const imageSlots = useMemo<ImageSlotInfo[]>(
        () => extractImageSlots(templateQuery.data?.data),
        [templateQuery.data],
    );

    const { createAndOpen, isCreating } = useCreateBannerFromAsset();

    const handleReset = () => {
        setSelectedTemplateId(null);
    };

    const handleClose = () => {
        handleReset();
        setSearch("");
        onClose();
    };

    const applyWithSlot = async (slotId?: string) => {
        if (!selectedTemplateId) return;
        try {
            await createAndOpen({
                assetId,
                imageUrl: assetId ? undefined : imageUrl,
                applyTemplate: selectedTemplateId,
                applySlot: slotId,
                name: templateQuery.data?.name
                    ? `Баннер — ${templateQuery.data.name}`
                    : "Новый баннер",
            });
            handleClose();
        } catch (e) {
            console.error("Не удалось создать баннер из шаблона:", e);
        }
    };

    if (!open) return null;

    const showingSlotPicker = !!selectedTemplateId;

    return (
        <Modal
            open={open}
            onClose={handleClose}
            title={showingSlotPicker ? "Куда вставить картинку?" : "Выберите шаблон"}
        >
            {showingSlotPicker ? (
                <SlotPickerStep
                    imageUrl={imageUrl}
                    slots={imageSlots}
                    isLoading={templateQuery.isLoading}
                    isCreating={isCreating}
                    templateName={templateQuery.data?.name}
                    onBack={handleReset}
                    onApply={applyWithSlot}
                />
            ) : (
                <TemplateGridStep
                    search={search}
                    onSearchChange={setSearch}
                    templates={listQuery.data ?? []}
                    isLoading={listQuery.isLoading}
                    onSelect={setSelectedTemplateId}
                />
            )}
        </Modal>
    );
}

// ─── Step 1: browse & pick template ────────────────────────────────────────

interface TemplateRow {
    id: string;
    name: string;
    description?: string | null;
    thumbnailUrl?: string | null;
    isOfficial?: boolean;
    resizes?: Array<{ id: string; width?: number; height?: number; name?: string }>;
}

function TemplateGridStep({
    search,
    onSearchChange,
    templates,
    isLoading,
    onSelect,
}: {
    search: string;
    onSearchChange: (s: string) => void;
    templates: TemplateRow[];
    isLoading: boolean;
    onSelect: (id: string) => void;
}) {
    return (
        <div className="space-y-4">
            <p className="text-[12px] text-text-secondary">
                Шаблон будет применён к новому баннер-проекту, а выбранная картинка
                подставлена в нужный слой автоматически.
            </p>

            <Input
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Поиск шаблона..."
                className="h-9"
            />

            {isLoading ? (
                <div className="flex items-center justify-center py-10">
                    <Loader2 size={20} className="animate-spin text-text-tertiary" />
                </div>
            ) : templates.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                    <LayoutTemplate size={32} className="text-text-tertiary/50" />
                    <p className="text-[12px] text-text-tertiary">
                        {search ? "Ничего не найдено" : "В этом воркспейсе пока нет шаблонов"}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
                    {templates.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => onSelect(t.id)}
                            className="group text-left p-3 rounded-xl border border-border-primary hover:border-accent-primary/40 bg-bg-primary transition-all cursor-pointer hover:shadow-md"
                        >
                            <div className="w-full aspect-[4/3] rounded-lg mb-2 overflow-hidden bg-bg-tertiary flex items-center justify-center">
                                {t.thumbnailUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={t.thumbnailUrl}
                                        alt={t.name}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                    />
                                ) : (
                                    <LayoutTemplate size={24} className="text-text-tertiary/60" />
                                )}
                            </div>
                            <div className="text-[12px] font-semibold text-text-primary truncate">
                                {t.name}
                            </div>
                            {t.description && (
                                <div className="text-[10px] text-text-tertiary line-clamp-1 mt-0.5">
                                    {t.description}
                                </div>
                            )}
                            <div className="text-[10px] text-text-tertiary mt-1">
                                {t.resizes?.length ?? 0} формат{(t.resizes?.length ?? 0) === 1 ? "" : "ов"}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Step 2: pick image slot inside chosen template ─────────────────────────

function SlotPickerStep({
    imageUrl,
    slots,
    isLoading,
    isCreating,
    templateName,
    onBack,
    onApply,
}: {
    imageUrl: string;
    slots: ImageSlotInfo[];
    isLoading: boolean;
    isCreating: boolean;
    templateName?: string;
    onBack: () => void;
    onApply: (slotId?: string) => void;
}) {
    const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

    // Auto-select when there is exactly one slot — no sense forcing a click.
    const effectiveSlot = selectedSlot ?? (slots.length === 1 ? slots[0].slotId : null);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-10">
                <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
        );
    }

    if (slots.length === 0) {
        return (
            <div className="space-y-4">
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                    <ImageIcon size={32} className="text-text-tertiary/50" />
                    <p className="text-[12px] text-text-secondary max-w-[320px]">
                        В шаблоне {templateName && <strong className="text-text-primary">{templateName}</strong>} нет
                        слотов для картинок. Можно применить шаблон без замены — тогда
                        картинка окажется новым слоем поверх шаблона.
                    </p>
                </div>
                <div className="flex items-center justify-between gap-2">
                    <Button variant="ghost" size="sm" onClick={onBack}>
                        <ArrowLeft size={14} /> Назад
                    </Button>
                    <Button
                        size="sm"
                        disabled={isCreating}
                        onClick={() => onApply(undefined)}
                    >
                        {isCreating ? (
                            <><Loader2 size={14} className="animate-spin" /> Создание...</>
                        ) : (
                            "Применить без замены"
                        )}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl border border-border-primary bg-bg-secondary">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={imageUrl}
                    alt="source"
                    className="w-14 h-14 rounded-lg object-cover border border-border-primary flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-text-primary truncate">
                        {templateName}
                    </div>
                    <div className="text-[11px] text-text-tertiary">
                        Выберите, куда подставить картинку
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 max-h-[340px] overflow-y-auto pr-1">
                {slots.map((slot) => {
                    const isSelected = effectiveSlot === slot.slotId;
                    return (
                        <button
                            key={slot.slotId}
                            onClick={() => setSelectedSlot(slot.slotId)}
                            className={`relative text-left p-2 rounded-xl border transition-all cursor-pointer ${
                                isSelected
                                    ? "border-accent-primary ring-2 ring-accent-primary/20 bg-accent-primary/5"
                                    : "border-border-primary hover:border-accent-primary/40 bg-bg-primary"
                            }`}
                        >
                            <div className="w-full aspect-square rounded-lg overflow-hidden bg-bg-tertiary mb-2 flex items-center justify-center">
                                {slot.previewSrc ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={slot.previewSrc}
                                        alt={slot.name}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                    />
                                ) : (
                                    <ImageIcon size={20} className="text-text-tertiary/60" />
                                )}
                            </div>
                            <div className="text-[12px] font-medium text-text-primary truncate">
                                {slot.name}
                            </div>
                            <div className="text-[10px] text-text-tertiary">
                                {slot.slotId}
                            </div>
                            {isSelected && (
                                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent-primary flex items-center justify-center">
                                    <Check size={12} className="text-white" />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" size="sm" onClick={onBack}>
                    <ArrowLeft size={14} /> Назад
                </Button>
                <Button
                    size="sm"
                    disabled={!effectiveSlot || isCreating}
                    onClick={() => effectiveSlot && onApply(effectiveSlot)}
                >
                    {isCreating ? (
                        <><Loader2 size={14} className="animate-spin" /> Создание...</>
                    ) : (
                        <>Применить <Check size={14} /></>
                    )}
                </Button>
            </div>
        </div>
    );
}
