"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import type { ArtboardProps } from "@/store/canvas/types";
import { DEFAULT_ARTBOARD_PROPS } from "@/store/canvas/types";
import { buildWizardArtboardPropsByFormatId, applyWizardArtboardPropsToPack } from "@/lib/resolveWizardArtboardProps";
import { Check, Globe2, LayoutTemplate, Layers3, Search, Star, Users, X } from "lucide-react";
import { useTemplateStore } from "@/store/templateStore";
import { useTemplateListSync } from "@/hooks/useTemplateSync";
import { useProjectStore } from "@/store/projectStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { DEFAULT_PACKS } from "@/constants/defaultPacks";
import { type TemplatePackV2 } from "@/services/templateService";
import type { BusinessUnit, ResizeFormat, TemplateTag } from "@/types";
import {
    createWizardLayerEntryResolver,
    getEditableLayerEntries,
    getPreviewFormatSources,
    WizardContentWorkspace,
    type WizardImageViewOverride,
    type WizardLayerStyleOverride,
    type WizardOutpaintHistoryEntry,
} from "@/components/wizard/WizardContentWorkspace";
import { WizardExportModal } from "@/components/wizard/WizardExportModal";
import {
    projectExpansionToResize,
    type LayerExpansionOverride,
} from "@/utils/wizardExpand";

export type WizardStep = "template" | "content";
type CatalogScope = "workspace" | "global" | "manual";
type CatalogPack = TemplatePackV2 & {
    _catalogSource: Exclude<CatalogScope, "manual">;
    _catalogKey: string;
    _thumbnailColor?: string;
};

export interface WizardHeaderState {
    step: WizardStep;
    nextLabel: string;
    nextDisabled: boolean;
    canGoBack: boolean;
    onBack: () => void;
    onNext: () => void;
    onSwitchToStudio: () => void;
    /** True when a photo layer with an image is selected (content step). */
    canOpenAiScenarios?: boolean;
    onOpenAiScenarios?: () => void;
}

interface WizardFlowProps {
    projectId?: string;
    onSwitchToStudio: () => void;
    initialTemplateId?: string | null;
    onHeaderStateChange?: (state: WizardHeaderState | null) => void;
    exportOpen?: boolean;
    onExportClose?: () => void;
}

const GLOBAL_VISIBILITIES = new Set(["PUBLIC"]);
const DEFAULT_THUMBNAIL_COLOR = "#6366F1";

function normalizeCatalogText(value: string | undefined): string {
    return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function getResizeSignature(resize: ResizeFormat): string {
    return `${normalizeCatalogText(resize.name || resize.label)}:${resize.width}x${resize.height}`;
}

function getPackSignature(pack: TemplatePackV2): string {
    const formats = (pack.resizes ?? [])
        .map(getResizeSignature)
        .sort()
        .join("|");
    return `${normalizeCatalogText(pack.name)}::${formats || "single"}`;
}

function isExplicitMasterFormat(resize: ResizeFormat): boolean {
    return resize.isMaster === true || resize.id === "master";
}

function getMasterFormat(pack: TemplatePackV2): ResizeFormat | undefined {
    return (pack.resizes ?? []).find((resize) => resize.isMaster) ?? pack.resizes?.[0];
}

function getSelectableFormats(pack: TemplatePackV2): ResizeFormat[] {
    const resizes = pack.resizes ?? [];
    const userFormats = resizes.filter((resize) => !isExplicitMasterFormat(resize));
    return userFormats.length > 0 ? userFormats : resizes;
}

function getDefaultSelectedFormatIds(pack: TemplatePackV2): string[] {
    return getSelectableFormats(pack).map((resize) => resize.id);
}

function buildCatalogKey(pack: TemplatePackV2, source: CatalogPack["_catalogSource"], fallbackId?: string): string {
    const workspaceId = (pack as TemplatePackV2 & { workspaceId?: string }).workspaceId ?? "local";
    return `${source}:${workspaceId}:${fallbackId ?? pack.id}`;
}

function isGlobalCatalogPack(pack: TemplatePackV2, currentWorkspaceId?: string | null): boolean {
    const workspaceId = (pack as TemplatePackV2 & { workspaceId?: string }).workspaceId;
    if (pack.isOfficial) return true;
    if (pack.visibility && GLOBAL_VISIBILITIES.has(pack.visibility)) return true;
    return Boolean(currentWorkspaceId && workspaceId && workspaceId !== currentWorkspaceId);
}

function dedupeCatalogPacks(packs: CatalogPack[]): CatalogPack[] {
    const byId = new Set<string>();
    const bySignature = new Set<string>();
    const result: CatalogPack[] = [];

    for (const pack of packs) {
        const idKey = pack.id;
        const signature = getPackSignature(pack);
        if (byId.has(idKey) || bySignature.has(signature)) continue;
        byId.add(idKey);
        bySignature.add(signature);
        result.push(pack);
    }

    return result;
}

function buildCatalogPacks(
    backendAndLocalPacks: TemplatePackV2[],
    currentWorkspaceId?: string | null,
): CatalogPack[] {
    const runtimePacks = backendAndLocalPacks.map((pack) => {
        const source = isGlobalCatalogPack(pack, currentWorkspaceId) ? "global" : "workspace";
        return {
            ...pack,
            _catalogSource: source,
            _catalogKey: buildCatalogKey(pack, source),
        } satisfies CatalogPack;
    });

    const defaultPacks = DEFAULT_PACKS.map((pack) => ({
        ...pack.data,
        _catalogSource: "global" as const,
        _catalogKey: buildCatalogKey(pack.data, "global", pack.id),
        _thumbnailColor: pack.thumbnailColor,
    }));

    return dedupeCatalogPacks([...runtimePacks, ...defaultPacks]);
}

function matchesCatalogSearch(pack: CatalogPack, query: string): boolean {
    const normalized = normalizeCatalogText(query);
    if (!normalized) return true;

    const haystack = [
        pack.name,
        pack.description,
        ...(pack.categories ?? []),
        ...(pack.businessUnits ?? []),
        ...(pack.tags ?? []).flatMap((tag) => [tag.id, tag.label]),
        ...(pack.resizes ?? []).flatMap((resize) => [
            resize.name,
            resize.label,
            `${resize.width}x${resize.height}`,
            `${resize.width}×${resize.height}`,
        ]),
    ].map((value) => normalizeCatalogText(value)).join(" ");

    return haystack.includes(normalized);
}

function sortCatalogPacks(packs: CatalogPack[], projectBU: BusinessUnit): CatalogPack[] {
    return [...packs].sort((a, b) => {
        const aRecommended = a.businessUnits?.includes(projectBU) ? 1 : 0;
        const bRecommended = b.businessUnits?.includes(projectBU) ? 1 : 0;
        if (aRecommended !== bRecommended) return bRecommended - aRecommended;
        if ((a.isOfficial ? 1 : 0) !== (b.isOfficial ? 1 : 0)) {
            return (b.isOfficial ? 1 : 0) - (a.isOfficial ? 1 : 0);
        }
        if ((a.popularity ?? 0) !== (b.popularity ?? 0)) return (b.popularity ?? 0) - (a.popularity ?? 0);
        return a.name.localeCompare(b.name);
    });
}

function getFormatLabel(format: ResizeFormat): string {
    return format.label || `${format.width}×${format.height}`;
}

function getFormatName(format: ResizeFormat): string {
    return format.name || getFormatLabel(format);
}

function buildWizardFormatPack(
    pack: TemplatePackV2,
    selectedFormatIds: string[],
    options: { includeHiddenMaster: boolean; selectedOnly?: boolean },
): TemplatePackV2 {
    if (!pack.resizes?.length) return pack;

    const selectedSet = new Set(selectedFormatIds);
    const selectableFormats = getSelectableFormats(pack);
    const masterFormat = getMasterFormat(pack);
    const effectiveSelectedRaw = selectedSet.size > 0
        ? pack.resizes.filter((resize) => selectedSet.has(resize.id))
        : selectableFormats;
    const effectiveSelected = effectiveSelectedRaw.map((resize) => (
        masterFormat && resize.id === masterFormat.id
            ? { ...resize, isMaster: true }
            : resize
    ));
    const shouldAddHiddenMaster =
        options.includeHiddenMaster
        && masterFormat
        && !effectiveSelected.some((resize) => resize.id === masterFormat.id);
    const resizes = [
        ...(shouldAddHiddenMaster ? [{ ...masterFormat, isMaster: true, _wizardHidden: true } as ResizeFormat] : []),
        ...effectiveSelected,
    ];

    return {
        ...pack,
        resizes,
        id: options.selectedOnly ? `${pack.id}__wizard_selection` : pack.id,
        name: pack.name,
        ...(options.selectedOnly ? { _wizardSelectedOnly: true } : {}),
    } as TemplatePackV2;
}

export function WizardFlow({
    projectId,
    onSwitchToStudio,
    initialTemplateId,
    onHeaderStateChange,
    exportOpen = false,
    onExportClose,
}: WizardFlowProps) {
    const { savedPacks } = useTemplateStore();
    const { backendTemplates, workspaceId } = useTemplateListSync();

    // Merge backend + local templates, backend takes priority
    const allPacks = useMemo(() => {
        const backendIds = new Set(backendTemplates.map(t => t.id));
        const uniqueLocal = savedPacks.filter(p => !backendIds.has(p.id));
        return [...backendTemplates, ...uniqueLocal];
    }, [backendTemplates, savedPacks]);
    const { projects } = useProjectStore();
    const [step, setStep] = useState<WizardStep>(initialTemplateId ? "content" : "template");
    const [catalogScope, setCatalogScope] = useState<CatalogScope>("workspace");
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(initialTemplateId || null);
    const [selectedFormatIds, setSelectedFormatIds] = useState<string[]>([]);
    const [fullSelectedTemplate, setFullSelectedTemplate] = useState<TemplatePackV2 | null>(null);
    const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);
    const [manualSizes, setManualSizes] = useState<{width: number; height: number; id: string}[]>([]);
    const [manualW, setManualW] = useState("1080");
    const [manualH, setManualH] = useState("1080");
    const [textValues, setTextValues] = useState<Record<string, string>>({});
    const [imageValues, setImageValues] = useState<Record<string, string>>({});
    const [imageViewOverrides, setImageViewOverrides] = useState<Record<string, WizardImageViewOverride>>({});
    const [layerStyleOverrides, setLayerStyleOverrides] = useState<Record<string, WizardLayerStyleOverride>>({});
    const [outpaintHistory, setOutpaintHistoryState] = useState<Record<string, WizardOutpaintHistoryEntry>>({});
    /**
     * Per-layer expand overrides set by the "Расширить фон" flow when the
     * AI returns an image larger than the original layer. Keyed by the
     * master layer/component id used as the anchor, but each entry also
     * carries `slotId`/`masterId` so we can match the same logical layer
     * in any non-master resize snapshot — see {@link projectExpansionToResize}.
     *
     * `prev`/`next` allow non-master snapshots to receive the same
     * proportional change via the studio's `relative_size` cascade.
     */
    const [layerGeometryOverrides, setLayerGeometryOverrides] = useState<
        Record<string, LayerExpansionOverride>
    >({});
    const [productDescription, setProductDescription] = useState("");
    const [packSearch, setPackSearch] = useState("");
    const [activePreviewFormatId, setActivePreviewFormatId] = useState("");
    const [formatArtboardProps, setFormatArtboardProps] = useState<Record<string, ArtboardProps>>({});
    const loadedTemplateIdRef = useRef<string | null>(initialTemplateId || null);
    const [aiScenariosTools, setAiScenariosTools] = useState<{
        canOpen: boolean;
        onOpen: () => void;
    } | null>(null);

    const setLayerGeometry = useCallback(
        (id: string, override: LayerExpansionOverride) => {
            setLayerGeometryOverrides((prev) => ({ ...prev, [id]: override }));
        },
        [],
    );

    const clearLayerGeometry = useCallback((id: string) => {
        setLayerGeometryOverrides((prev) => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
        });
    }, []);

    const setImageViewOverride = useCallback((id: string, override: WizardImageViewOverride | null) => {
        setImageViewOverrides((prev) => {
            if (!override) {
                if (!(id in prev)) return prev;
                const next = { ...prev };
                delete next[id];
                return next;
            }
            return { ...prev, [id]: override };
        });
    }, []);

    const setLayerStyleOverride = useCallback((id: string, override: WizardLayerStyleOverride) => {
        setLayerStyleOverrides((prev) => ({
            ...prev,
            [id]: {
                ...(prev[id] ?? {}),
                ...override,
            },
        }));
    }, []);

    const setOutpaintHistory = useCallback((id: string, entry: WizardOutpaintHistoryEntry) => {
        setOutpaintHistoryState((prev) => ({ ...prev, [id]: entry }));
    }, []);

    const clearOutpaintHistory = useCallback((id: string) => {
        setOutpaintHistoryState((prev) => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
        });
    }, []);

    // Get project BU for recommendations
    const activeProject = projects.find(p => p.id === projectId);
    const projectBU: BusinessUnit = activeProject?.businessUnit || "yandex-market";

    const catalogPacks = useMemo(
        () => buildCatalogPacks(allPacks, workspaceId),
        [allPacks, workspaceId],
    );
    const visibleCatalogPacks = useMemo(() => {
        if (catalogScope === "manual") return [];
        return sortCatalogPacks(
            catalogPacks.filter((pack) => pack._catalogSource === catalogScope && matchesCatalogSearch(pack, packSearch)),
            projectBU,
        );
    }, [catalogPacks, catalogScope, packSearch, projectBU]);
    const selectedCatalogPack = useMemo(
        () => catalogPacks.find((pack) => pack.id === selectedTemplateId) ?? null,
        [catalogPacks, selectedTemplateId],
    );
    const selectableFormats = useMemo(
        () => selectedCatalogPack ? getSelectableFormats(selectedCatalogPack) : [],
        [selectedCatalogPack],
    );

    // Fetch full template data when user selects a template
    useEffect(() => {
        if (!selectedTemplateId) {
            loadedTemplateIdRef.current = null;
            queueMicrotask(() => setFullSelectedTemplate(null));
            return;
        }
        if (loadedTemplateIdRef.current === selectedTemplateId && fullSelectedTemplate) return;

        const fetchId = selectedTemplateId;
        const setLoadedTemplate = (pack: TemplatePackV2) => {
            loadedTemplateIdRef.current = fetchId;
            queueMicrotask(() => setFullSelectedTemplate(pack));
        };

        // Check if it's a DEFAULT_PACK (already has full data)
        const defaultPack = DEFAULT_PACKS.find(p => p.id === fetchId || p.data.id === fetchId);
        if (defaultPack) { setLoadedTemplate(defaultPack.data); return; }

        // Check if it's a local pack (has masterComponents)
        const localPack = savedPacks.find(p => p.id === fetchId);
        if (localPack && localPack.masterComponents?.length > 0) { setLoadedTemplate(localPack); return; }

        // Fetch full data from backend REST endpoint
        let cancelled = false;
        queueMicrotask(() => setTemplateLoadError(null));
        (async () => {
            try {
                const res = await fetch(`/api/template/${fetchId}`);
                if (cancelled) return;
                if (!res.ok) {
                    console.warn(`[Wizard] Template fetch failed: HTTP ${res.status}`);
                    setTemplateLoadError(`Не удалось загрузить шаблон (HTTP ${res.status}). Попробуйте другой шаблон или обновите страницу.`);
                    const listingPack = allPacks.find(p => p.id === fetchId);
                    if (listingPack) setLoadedTemplate(listingPack);
                    return;
                }
                const template = await res.json();
                if (template?.data) {
                    setLoadedTemplate(template.data as TemplatePackV2);
                    return;
                }
                setTemplateLoadError("Шаблон не содержит данных. Попробуйте другой шаблон.");
            } catch (err) {
                if (!cancelled) {
                    console.warn("[Wizard] Template fetch error:", err);
                    setTemplateLoadError("Ошибка загрузки шаблона. Возможно, он слишком большой.");
                    const listingPack = allPacks.find(p => p.id === fetchId);
                    if (listingPack) setLoadedTemplate(listingPack);
                }
            }
        })();
        return () => { cancelled = true; };
    }, [allPacks, fullSelectedTemplate, selectedTemplateId, savedPacks]);

    const selectedTemplate = useMemo(
        () => fullSelectedTemplate
            ? buildWizardFormatPack(fullSelectedTemplate, selectedFormatIds, { includeHiddenMaster: true, selectedOnly: true })
            : null,
        [fullSelectedTemplate, selectedFormatIds],
    );

    useEffect(() => {
        const nextByFormat = selectedTemplate
            ? buildWizardArtboardPropsByFormatId(selectedTemplate)
            : {};
        queueMicrotask(() => setFormatArtboardProps(nextByFormat));
    }, [selectedTemplate]);

    const handleFormatArtboardPropsChange = useCallback((
        formatId: string,
        updater: React.SetStateAction<ArtboardProps>,
    ) => {
        setFormatArtboardProps((prev) => {
            const current = prev[formatId] ?? DEFAULT_ARTBOARD_PROPS;
            const next = typeof updater === "function" ? updater(current) : updater;
            return { ...prev, [formatId]: next };
        });
    }, []);

    const handleApplyAndContinue = useCallback(async () => {
        if (catalogScope !== "manual" && !selectedTemplateId) return;

        let packToApply: TemplatePackV2;

        if (catalogScope === "manual") {
            if (manualSizes.length === 0) return;
            const masterSize = manualSizes[0];
            
            packToApply = {
                id: "manual_" + Date.now(),
                name: "Свой пакет форматов",
                description: "Собранные вручную форматы",
                isOfficial: false,
                baseWidth: masterSize.width,
                baseHeight: masterSize.height,
                masterComponents: [],
                componentInstances: [],
                resizes: manualSizes.map((sz, i) => ({
                     id: i === 0 ? "master" : `resize_${i}`,
                     name: `Формат ${sz.width}x${sz.height}`,
                     label: `${sz.width}×${sz.height}`,
                     width: sz.width,
                     height: sz.height,
                     instancesEnabled: i !== 0
                }))
            } as unknown as TemplatePackV2;
        } else {
            if (!fullSelectedTemplate) return;
            packToApply = JSON.parse(JSON.stringify(
                buildWizardFormatPack(fullSelectedTemplate, selectedFormatIds, { includeHiddenMaster: true }),
            ));
        }

        const { applyTemplatePack } = await import("@/services/templateService");

        const dataAny = packToApply as any;
        const previewSources = getPreviewFormatSources(packToApply);
        const masterPreviewSource = previewSources.find((format) => format.isMaster) ?? previewSources[0];
        const editableEntries = getEditableLayerEntries(packToApply, masterPreviewSource?.layers ?? []);
        const editableSlotCounts = new Map<string, number>();
        for (const entry of editableEntries) {
            if (!entry.slotId || entry.slotId === "none") continue;
            const key = `${entry.type}:${entry.slotId}`;
            editableSlotCounts.set(key, (editableSlotCounts.get(key) ?? 0) + 1);
        }

        // Legacy fallback: unique slotId → value. Duplicated slots must be
        // applied directly to layers/snapshots so one field cannot overwrite
        // every layer with the same semantic slot.
        const contentOverrides: Record<string, string> = {};

        const layerSlotId = (layer: any): string | undefined => layer.slotId || layer.props?.slotId;
        const layerDraftTarget = (layer: any) => ({
            id: typeof layer.id === "string" ? layer.id : undefined,
            masterId: typeof layer.masterId === "string"
                ? layer.masterId
                : typeof layer.masterComponentId === "string"
                    ? layer.masterComponentId
                    : undefined,
            type: typeof layer.type === "string" ? layer.type : undefined,
            slotId: layerSlotId(layer),
        });
        const canUseSlotOverride = (layer: any): boolean => {
            const slotId = layerSlotId(layer);
            if (!slotId || slotId === "none" || typeof layer.type !== "string") return false;
            return editableSlotCounts.get(`${layer.type}:${slotId}`) === 1;
        };
        const rememberContentOverride = (layer: any, value: string) => {
            const slotId = layerSlotId(layer);
            if (!slotId || !canUseSlotOverride(layer)) return;
            contentOverrides[slotId] = value;
        };
        const findDraft = <T,>(
            layer: any,
            drafts: Record<string, T>,
            resolver: ReturnType<typeof createWizardLayerEntryResolver>,
        ): T | undefined => {
            const ids = resolver.getCandidateIds(layerDraftTarget(layer));
            return ids.map((id) => drafts[id]).find((value) => value !== undefined);
        };

        const findExpansionDraft = (
            layer: any,
            resolver: ReturnType<typeof createWizardLayerEntryResolver>,
        ): LayerExpansionOverride | undefined => {
            const ids = resolver.getCandidateIds(layerDraftTarget(layer));
            for (const id of ids) {
                const direct = layerGeometryOverrides[id];
                if (direct) return direct;
            }
            const slotId = layerSlotId(layer);
            if (slotId && canUseSlotOverride(layer)) {
                const bySlot = Object.values(layerGeometryOverrides).find((override) => override.slotId === slotId);
                if (bySlot) return bySlot;
            }
            if (layer.masterId) {
                return Object.values(layerGeometryOverrides).find((override) => override.masterId === layer.masterId);
            }
            return undefined;
        };

        const getContentDraftValue = (
            layer: any,
            resolver: ReturnType<typeof createWizardLayerEntryResolver>,
        ): string | undefined => {
            if (layer.type === "text" || layer.type === "badge") {
                return findDraft(layer, textValues, resolver);
            }
            if (layer.type === "image" && !layer.isFixedAsset) {
                return findDraft(layer, imageValues, resolver);
            }
            return undefined;
        };

        const applyContentDraftToLayer = (
            layer: any,
            resolver: ReturnType<typeof createWizardLayerEntryResolver>,
        ) => {
            const value = getContentDraftValue(layer, resolver);
            if (value === undefined) return;
            if (layer.type === "text") layer.text = value;
            else if (layer.type === "badge") layer.label = value;
            else if (layer.type === "image" && !layer.isFixedAsset) layer.src = value;
            rememberContentOverride(layer, value);
        };

        const applyVisualDraftsToLayer = (
            layer: any,
            resolver: ReturnType<typeof createWizardLayerEntryResolver>,
        ) => {
            if (layer.type === "image" && !layer.isFixedAsset) {
                const viewDraft = findDraft(layer, imageViewOverrides, resolver);
                if (viewDraft) {
                    if (viewDraft.objectFit !== undefined) layer.objectFit = viewDraft.objectFit;
                    if (viewDraft.focusX !== undefined) layer.focusX = viewDraft.focusX;
                    if (viewDraft.focusY !== undefined) layer.focusY = viewDraft.focusY;
                }
            }
            const styleDraft = findDraft(layer, layerStyleOverrides, resolver);
            if (!styleDraft) return;
            if (layer.type === "text" && styleDraft.fill) layer.fill = styleDraft.fill;
            if (layer.type === "badge" && styleDraft.textColor) layer.textColor = styleDraft.textColor;
        };

        const applyDraftsFromLayers = (layers: any[], layerBindings?: any[]) => {
            const resolver = createWizardLayerEntryResolver(editableEntries, layers.map(layerDraftTarget), layerBindings);
            for (const layer of layers) {
                applyContentDraftToLayer(layer, resolver);
                applyVisualDraftsToLayer(layer, resolver);
            }
        };

        const applyOverridesToSnapshot = (layers: any[], layerBindings?: any[]) => {
            const resolver = createWizardLayerEntryResolver(editableEntries, layers.map(layerDraftTarget), layerBindings);
            for (const layer of layers) {
                if (layer.isFixedAsset) continue;
                const sid = layer.slotId;
                if (sid && sid !== "none" && canUseSlotOverride(layer) && contentOverrides[sid]) {
                    const val = contentOverrides[sid];
                    if (layer.type === "text") layer.text = val;
                    else if (layer.type === "image") layer.src = val;
                    else if (layer.type === "badge") layer.label = val;
                }
                applyVisualDraftsToLayer(layer, resolver);
            }
        };

        const masterComponentLayers = packToApply.masterComponents.map((mc) => ({
            ...(mc.props as unknown as Record<string, unknown>),
            id: mc.id,
            type: mc.type,
            name: mc.name,
            slotId: mc.slotId || (mc.props as any).slotId,
        }));
        const masterComponentResolver = createWizardLayerEntryResolver(editableEntries, masterComponentLayers);

        // Apply content by concrete master component or matching editable layer
        // directly to masterComponents for the legacy hydration path.
        packToApply.masterComponents = packToApply.masterComponents.map(mc => {
            const target = {
                ...(mc.props as unknown as Record<string, unknown>),
                id: mc.id,
                type: mc.type,
                name: mc.name,
                slotId: mc.slotId || (mc.props as any).slotId,
            };
            const override = findExpansionDraft(target, masterComponentResolver);
            const viewDraft = findDraft(target, imageViewOverrides, masterComponentResolver);
            const styleDraft = findDraft(target, layerStyleOverrides, masterComponentResolver);
            const contentDraft = getContentDraftValue(target, masterComponentResolver);
            if (contentDraft !== undefined) rememberContentOverride(target, contentDraft);

            const baseProps = {
                ...(override ? { ...mc.props, ...override.next } : mc.props),
                ...(mc.type === "image" && viewDraft ? viewDraft : {}),
                ...(mc.type === "text" && styleDraft?.fill ? { fill: styleDraft.fill } : {}),
                ...(mc.type === "badge" && styleDraft?.textColor ? { textColor: styleDraft.textColor } : {}),
            };
            if ((mc.type === "text" || mc.type === "badge") && contentDraft !== undefined) {
                return {
                    ...mc,
                    props: {
                        ...baseProps,
                        [mc.type === "text" ? "text" : "label"]: contentDraft,
                    },
                };
            }
            if (mc.type === "image" && contentDraft !== undefined && !(mc.props as any).isFixedAsset) {
                return { ...mc, props: { ...baseProps, src: contentDraft } };
            }
            if (override || viewDraft || styleDraft) {
                return { ...mc, props: baseProps };
            }
            return mc;
        });

        // Source 2: Scan layers[] and layerSnapshot[] directly for raw canvas state
        // where MC IDs may not match, and ensures snapshots get overrides applied.
        if (dataAny.layers && Array.isArray(dataAny.layers)) {
            applyDraftsFromLayers(dataAny.layers);
        }

        if (dataAny.resizes && Array.isArray(dataAny.resizes)) {
            for (const resize of dataAny.resizes) {
                if (resize.layerSnapshot && Array.isArray(resize.layerSnapshot)) {
                    applyDraftsFromLayers(resize.layerSnapshot, resize.layerBindings);
                }
            }
        }

        if (dataAny.resizes && Array.isArray(dataAny.resizes)) {
            for (const resize of dataAny.resizes) {
                if (resize.layerSnapshot && Array.isArray(resize.layerSnapshot)) {
                    applyOverridesToSnapshot(resize.layerSnapshot, resize.layerBindings);
                }
            }
        }

        // Apply expand overrides to every snapshot in the pack:
        //   - master snapshot gets `next` directly (it's where the wizard
        //     measured the new geometry)
        //   - every non-master snapshot is projected through the same
        //     master→instance cascade that runs in the studio so the
        //     extended image actually fills each resize instead of being
        //     cropped back into the original tiny slot by object-fit cover.
        const hasOverrides = Object.keys(layerGeometryOverrides).length > 0;
        const hasViewOverrides = Object.keys(imageViewOverrides).length > 0;
        const hasProjectionOverrides = hasOverrides || hasViewOverrides;
        if (hasProjectionOverrides) {
            const masterResize =
                Array.isArray(dataAny.resizes)
                    ? dataAny.resizes.find((r: any) => r.isMaster) ?? dataAny.resizes[0]
                    : null;
            const masterArtboard = masterResize
                ? { width: masterResize.width, height: masterResize.height }
                : { width: dataAny.canvasWidth ?? 0, height: dataAny.canvasHeight ?? 0 };

            if (Array.isArray(dataAny.resizes)) {
                for (const resize of dataAny.resizes) {
                    if (!Array.isArray(resize.layerSnapshot)) continue;
                    resize.layerSnapshot = projectExpansionToResize({
                        resizeLayers: resize.layerSnapshot,
                        resizeBindings: resize.layerBindings,
                        resizeArtboard: { width: resize.width, height: resize.height },
                        resizeFormatId: resize.id,
                        masterArtboard,
                        overrides: layerGeometryOverrides,
                        imageViewOverrides,
                    });
                }
            }
            if (dataAny.layers && Array.isArray(dataAny.layers)) {
                dataAny.layers = projectExpansionToResize({
                    resizeLayers: dataAny.layers,
                    resizeArtboard: masterArtboard,
                    resizeFormatId: masterResize?.id,
                    masterArtboard,
                    overrides: layerGeometryOverrides,
                    imageViewOverrides,
                });
            }
        }

        packToApply = applyWizardArtboardPropsToPack(packToApply, formatArtboardProps);

        applyTemplatePack(packToApply, {
            contentOverrides: Object.keys(contentOverrides).length > 0 ? contentOverrides : undefined,
            onSuccess: () => {
                onSwitchToStudio();
            }
        });
    }, [
        fullSelectedTemplate,
        imageViewOverrides,
        imageValues,
        layerStyleOverrides,
        layerGeometryOverrides,
        manualSizes,
        onSwitchToStudio,
        selectedTemplateId,
        selectedFormatIds,
        catalogScope,
        textValues,
        formatArtboardProps,
    ]);

    const nextDisabled =
        step === "template"
            ? catalogScope === "manual"
                ? manualSizes.length === 0
                : !selectedTemplateId || (selectableFormats.length > 0 && selectedFormatIds.length === 0)
            : false;

    const handleHeaderBack = useCallback(() => {
        if (step === "content") {
            setStep("template");
        }
    }, [step]);

    const handleHeaderNext = useCallback(() => {
        if (step === "template") {
            if (catalogScope === "manual") {
                void handleApplyAndContinue();
                return;
            }
            if (!selectedTemplateId) return;
            setStep("content");
            return;
        }

        void handleApplyAndContinue();
    }, [catalogScope, handleApplyAndContinue, selectedTemplateId, step]);

    const handleHeaderSwitchToStudio = useCallback(() => {
        if (step === "content") {
            void handleApplyAndContinue();
            return;
        }
        onSwitchToStudio();
    }, [handleApplyAndContinue, onSwitchToStudio, step]);

    useEffect(() => {
        onHeaderStateChange?.({
            step,
            nextLabel: step === "template" && catalogScope === "manual" ? "Собрать" : step === "content" ? "Применить" : "Далее",
            nextDisabled,
            canGoBack: step === "content",
            onBack: handleHeaderBack,
            onNext: handleHeaderNext,
            onSwitchToStudio: handleHeaderSwitchToStudio,
            canOpenAiScenarios: step === "content" && (aiScenariosTools?.canOpen ?? false),
            onOpenAiScenarios: aiScenariosTools?.onOpen,
        });
    }, [
        aiScenariosTools,
        handleHeaderBack,
        handleHeaderNext,
        handleHeaderSwitchToStudio,
        nextDisabled,
        onHeaderStateChange,
        step,
        catalogScope,
    ]);

    useEffect(() => {
        return () => onHeaderStateChange?.(null);
    }, [onHeaderStateChange]);

    const handleSelectCatalogPack = useCallback((pack: CatalogPack) => {
        setSelectedTemplateId(pack.id);
        setSelectedFormatIds(getDefaultSelectedFormatIds(pack));
        setFullSelectedTemplate(null);
        loadedTemplateIdRef.current = null;
        setTemplateLoadError(null);
    }, []);

    const toggleSelectedFormat = useCallback((formatId: string) => {
        setSelectedFormatIds((prev) => {
            if (prev.includes(formatId)) return prev.filter((id) => id !== formatId);
            return [...prev, formatId];
        });
    }, []);

    /* ─── Pack Card (catalog-first) ─────────────────────── */
    const PackCard = ({ pack }: { pack: CatalogPack }) => {
        const displayColor = pack._thumbnailColor || DEFAULT_THUMBNAIL_COLOR;
        const isSelected = selectedTemplateId === pack.id;
        const formats = getSelectableFormats(pack);
        const selectedCount = isSelected
            ? formats.filter((format) => selectedFormatIds.includes(format.id)).length
            : formats.length;

        return (
            <button
                type="button"
                onClick={() => handleSelectCatalogPack(pack)}
                aria-pressed={isSelected}
                className={`relative grid w-full grid-cols-[116px_minmax(0,1fr)] gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer hover:shadow-md
                    ${isSelected ? "border-accent-primary bg-accent-primary/5 ring-1 ring-accent-primary" : "border-border-primary bg-bg-primary hover:border-accent-primary/40"}
                `}
            >
                <div
                    className="relative flex h-24 items-center justify-center overflow-hidden rounded-lg bg-bg-secondary"
                    style={!pack.thumbnailUrl ? { backgroundColor: `${displayColor}15` } : undefined}
                >
                    {pack.thumbnailUrl ? (
                        <img
                            src={pack.thumbnailUrl}
                            alt={pack.name}
                            className="h-full w-full object-cover"
                            draggable={false}
                        />
                    ) : (
                        <LayoutTemplate size={28} style={{ color: displayColor }} />
                    )}
                    {isSelected && (
                        <span className="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent-primary text-text-inverse shadow-[var(--shadow-sm)]">
                            <Check size={12} />
                        </span>
                    )}
                </div>
                <div className="min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-text-primary">{pack.name || "Без названия"}</div>
                            <div className="mt-0.5 line-clamp-1 text-[11px] text-text-tertiary">{pack.description || "Пакет форматов"}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            {pack.isOfficial && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600">
                                    <Star size={8} className="fill-amber-500 text-amber-500" />
                                    Official
                                </span>
                            )}
                            <span className="inline-flex items-center gap-1 rounded-full border border-border-primary bg-bg-secondary px-1.5 py-0.5 text-[9px] font-medium text-text-secondary">
                                {pack._catalogSource === "workspace" ? <Users size={8} /> : <Globe2 size={8} />}
                                {pack._catalogSource === "workspace" ? "Воркспейс" : "Глобальный"}
                            </span>
                        </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                        {(pack.categories || []).slice(0, 3).map((category: string) => (
                            <span key={category} className="rounded-md bg-bg-secondary px-1.5 py-0.5 text-[9px] text-text-secondary">
                                {category}
                            </span>
                        ))}
                        {(pack.tags || []).slice(0, 2).map((tag: TemplateTag) => (
                            <span
                                key={tag.id}
                                className="rounded-full border border-border-primary px-1.5 py-0.5 text-[9px] text-text-tertiary"
                                style={tag.color ? { borderColor: `${tag.color}40`, color: tag.color } : undefined}
                            >
                                #{tag.label}
                            </span>
                        ))}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap gap-1">
                            {formats.slice(0, 4).map((format) => (
                                <span key={format.id} className="rounded-md border border-border-primary bg-bg-surface px-1.5 py-0.5 text-[9px] text-text-secondary">
                                    {getFormatLabel(format)}
                                </span>
                            ))}
                            {formats.length > 4 && (
                                <span className="rounded-md bg-bg-secondary px-1.5 py-0.5 text-[9px] text-text-tertiary">
                                    +{formats.length - 4}
                                </span>
                            )}
                        </div>
                        <span className="shrink-0 text-[10px] text-text-tertiary">
                            {isSelected ? `${selectedCount}/${formats.length || 1}` : `${formats.length || 1} фмт`}
                        </span>
                    </div>
                </div>
            </button>
        );
    };

    const BU_LABELS: Record<string, string> = {
        "yandex-market": "Маркет",
        "yandex-go": "Go",
        "yandex-food": "Еда",
        "yandex-lavka": "Лавка",
        "other": "Другое",
    };
    const isContentStep = step === "content" && !!selectedTemplate;

    return (
        <div className={`flex-1 flex items-center justify-center bg-bg-secondary overflow-hidden ${isContentStep ? "p-0" : "p-8"}`}>
            <div className={`w-full bg-bg-primary overflow-hidden flex flex-col max-h-full ${
                isContentStep
                    ? "h-full border-0 rounded-none shadow-none"
                    : "max-w-5xl rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] border border-border-primary"
            }`}>
                <div className={`${isContentStep ? "p-0 overflow-hidden" : "p-6 overflow-y-auto"} flex-1 min-h-0`}>
                    {/* Step 1: Template */}
                    {step === "template" && (
                        <div className="space-y-4">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h2 className="text-lg font-semibold text-text-primary">Выберите основу</h2>
                                    <p className="text-sm text-text-secondary mt-1">
                                        Выберите пакет и отметьте форматы, которые нужны в этом проекте.
                                    </p>
                                </div>
                                <div className="flex bg-bg-secondary rounded-[var(--radius-md)] p-1 border border-border-primary">
                                    <button
                                        onClick={() => setCatalogScope("workspace")}
                                        className={`px-3 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-all cursor-pointer ${catalogScope === "workspace" ? "bg-bg-surface shadow-[var(--shadow-sm)] text-text-primary" : "text-text-secondary"}`}
                                    >
                                        Воркспейс
                                    </button>
                                    <button
                                        onClick={() => setCatalogScope("global")}
                                        className={`px-3 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-all cursor-pointer ${catalogScope === "global" ? "bg-bg-surface shadow-[var(--shadow-sm)] text-text-primary" : "text-text-secondary"}`}
                                    >
                                        Глобальные
                                    </button>
                                    <button
                                        onClick={() => setCatalogScope("manual")}
                                        className={`px-3 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-all cursor-pointer ${catalogScope === "manual" ? "bg-bg-surface shadow-[var(--shadow-sm)] text-text-primary" : "text-text-secondary"}`}
                                    >
                                        Вручную
                                    </button>
                                </div>
                            </div>

                            {catalogScope === "manual" ? (
                                <div className="space-y-4">
                                     <p className="text-sm text-text-secondary">Укажите список форматов (ширина × высота), для которых вы хотите собрать креативы с нуля.</p>
                                     <div className="flex gap-2 items-center">
                                         <input type="number" value={manualW} onChange={e => setManualW(e.target.value)} className="w-24 h-9 px-3 text-sm rounded-lg border border-border-primary bg-bg-secondary text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/20" placeholder="W" />
                                         <span className="text-text-tertiary">×</span>
                                         <input type="number" value={manualH} onChange={e => setManualH(e.target.value)} className="w-24 h-9 px-3 text-sm rounded-lg border border-border-primary bg-bg-secondary text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/20" placeholder="H" />
                                         <Button variant="secondary" onClick={() => {
                                             const w = parseInt(manualW);
                                             const h = parseInt(manualH);
                                             if (w > 0 && h > 0) {
                                                setManualSizes(prev => [...prev, { width: w, height: h, id: Math.random().toString(36).substr(2, 9) }]);
                                             }
                                         }}>Добавить</Button>
                                     </div>
                                     <div className="flex flex-wrap gap-2 mt-4 min-h-8">
                                        {manualSizes.map(sz => (
                                             <div key={sz.id} className="flex items-center gap-1.5 bg-bg-secondary px-2.5 py-1.5 rounded-[var(--radius-md)] border border-border-primary text-xs text-text-secondary font-medium shadow-sm">
                                                  {sz.width} × {sz.height}
                                                  <button className="text-text-tertiary hover:text-text-primary cursor-pointer transition-colors" onClick={() => setManualSizes(prev => prev.filter(s => s.id !== sz.id))}><X size={12} /></button>
                                             </div>
                                        ))}
                                        {manualSizes.length === 0 && <span className="text-xs text-text-tertiary">Форматы не добавлены. Добавьте хотя бы один.</span>}
                                     </div>
                                </div>
                            ) : (
                                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                                    <div className="space-y-3">
                                        <div className="relative">
                                            <Input
                                                value={packSearch}
                                                onChange={(e) => setPackSearch(e.target.value)}
                                                placeholder={catalogScope === "workspace" ? "Найти пакет в воркспейсе..." : "Найти глобальный пакет..."}
                                                icon={<Search size={14} />}
                                                className="h-10 text-sm pr-8"
                                            />
                                            {packSearch && (
                                                <button
                                                    type="button"
                                                    onClick={() => setPackSearch("")}
                                                    aria-label="Очистить поиск"
                                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary cursor-pointer"
                                                >
                                                    <X size={14} />
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
                                                <Layers3 size={13} />
                                                <span>
                                                    {visibleCatalogPacks.length} пакет(ов), сначала релевантные для {BU_LABELS[projectBU] || projectBU}
                                                </span>
                                            </div>
                                            {packSearch && (
                                                <span className="rounded-full border border-border-primary bg-bg-secondary px-2 py-0.5 text-[10px] text-text-secondary">
                                                    Поиск: {packSearch}
                                                </span>
                                            )}
                                        </div>
                                        <div className="grid gap-3">
                                            {visibleCatalogPacks.map((pack) => (
                                                <PackCard key={pack._catalogKey} pack={pack} />
                                            ))}
                                        </div>
                                        {visibleCatalogPacks.length === 0 && (
                                            <div className="rounded-xl border border-dashed border-border-primary bg-bg-secondary px-4 py-8 text-center text-sm text-text-tertiary">
                                                Ничего не найдено в этой вкладке.
                                            </div>
                                        )}
                                    </div>

                                    <aside className="rounded-xl border border-border-primary bg-bg-secondary p-4">
                                        {selectedCatalogPack ? (
                                            <div className="space-y-4">
                                                <div>
                                                    <div className="text-sm font-semibold text-text-primary">{selectedCatalogPack.name}</div>
                                                    <p className="mt-1 text-xs text-text-secondary">
                                                        Отметьте форматы, которые попадут в визард и экспорт.
                                                    </p>
                                                </div>
                                                {selectableFormats.length > 0 ? (
                                                    <>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[11px] font-medium uppercase text-text-tertiary">
                                                                Форматы ({selectedFormatIds.length}/{selectableFormats.length})
                                                            </span>
                                                            <div className="flex gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setSelectedFormatIds(selectableFormats.map((format) => format.id))}
                                                                    className="text-[10px] text-accent-primary hover:underline cursor-pointer"
                                                                >
                                                                    Все
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setSelectedFormatIds([])}
                                                                    className="text-[10px] text-text-tertiary hover:text-text-primary cursor-pointer"
                                                                >
                                                                    Снять
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            {selectableFormats.map((format) => {
                                                                const checked = selectedFormatIds.includes(format.id);
                                                                return (
                                                                    <button
                                                                        key={format.id}
                                                                        type="button"
                                                                        onClick={() => toggleSelectedFormat(format.id)}
                                                                        className={`flex w-full items-center gap-2 rounded-[var(--radius-md)] border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                                                                            checked
                                                                                ? "border-accent-primary/30 bg-accent-primary/10"
                                                                                : "border-border-primary bg-bg-primary hover:border-border-secondary"
                                                                        }`}
                                                                    >
                                                                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                                                            checked ? "border-accent-primary bg-accent-primary text-text-inverse" : "border-border-secondary"
                                                                        }`}>
                                                                            {checked && <Check size={10} />}
                                                                        </span>
                                                                        <span className="min-w-0 flex-1">
                                                                            <span className="block truncate text-xs font-medium text-text-primary">{getFormatName(format)}</span>
                                                                            <span className="block text-[10px] text-text-tertiary">{format.width} × {format.height}</span>
                                                                        </span>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                        {(() => {
                                                            const masterFormat = getMasterFormat(selectedCatalogPack);
                                                            const addsHiddenMaster = Boolean(masterFormat && !selectedFormatIds.includes(masterFormat.id));
                                                            return addsHiddenMaster ? (
                                                                <p className="rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-[11px] text-text-secondary">
                                                                    Мастер-формат будет добавлен технически для каскада, но не появится как отдельный выбранный формат.
                                                                </p>
                                                            ) : null;
                                                        })()}
                                                    </>
                                                ) : (
                                                    <p className="rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-xs text-text-secondary">
                                                        Это одиночный шаблон без дополнительных форматов.
                                                    </p>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
                                                <LayoutTemplate size={28} className="text-text-tertiary/60" />
                                                <p className="mt-3 text-sm font-medium text-text-primary">Пакет не выбран</p>
                                                <p className="mt-1 text-xs text-text-tertiary">
                                                    Выберите пакет слева, затем отметьте нужные форматы.
                                                </p>
                                            </div>
                                        )}
                                    </aside>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 2: Content */}
                    {step === "content" && selectedTemplate && (
                        <>
                            <WizardContentWorkspace
                                selectedTemplate={selectedTemplate}
                                templateLoadError={templateLoadError}
                                formatArtboardProps={formatArtboardProps}
                                onFormatArtboardPropsChange={handleFormatArtboardPropsChange}
                                textValues={textValues}
                                imageValues={imageValues}
                                imageViewOverrides={imageViewOverrides}
                                layerStyleOverrides={layerStyleOverrides}
                                outpaintHistory={outpaintHistory}
                                setTextValues={setTextValues}
                                setImageValues={setImageValues}
                                setImageViewOverride={setImageViewOverride}
                                setLayerStyleOverride={setLayerStyleOverride}
                                setOutpaintHistory={setOutpaintHistory}
                                clearOutpaintHistory={clearOutpaintHistory}
                                layerGeometryOverrides={layerGeometryOverrides}
                                setLayerGeometry={setLayerGeometry}
                                clearLayerGeometry={clearLayerGeometry}
                                productDescription={productDescription}
                                projectBU={projectBU}
                                projectId={projectId}
                                onActivePreviewFormatChange={setActivePreviewFormatId}
                                onAiScenariosToolsChange={setAiScenariosTools}
                            />
                            <WizardExportModal
                                open={exportOpen}
                                onClose={onExportClose ?? (() => undefined)}
                                selectedTemplate={selectedTemplate}
                                activeFormatId={activePreviewFormatId}
                                formatArtboardProps={formatArtboardProps}
                                textValues={textValues}
                                imageValues={imageValues}
                                imageViewOverrides={imageViewOverrides}
                                layerStyleOverrides={layerStyleOverrides}
                                layerGeometryOverrides={layerGeometryOverrides}
                            />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
