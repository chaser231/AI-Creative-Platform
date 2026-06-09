import { v4 as uuid } from "uuid";
import {
    type AdaptationDiagnostic,
    type AdaptationDiagnosticCode,
    type FrameLayer,
    type Layer,
    type LayerBinding,
    type ResizeFormat,
} from "@/types";
import { AdaptationPresets, runAdaptationPipeline } from "@/services/adaptationPipeline";
import type { ArtboardSize } from "@/services/adaptationProjection";
export { projectTree } from "@/services/adaptationProjection";

/** @deprecated Use AdaptationDiagnostic from @/types */
export type CustomResizeDiagnosticCode = AdaptationDiagnosticCode;
/** @deprecated Use AdaptationDiagnostic from @/types */
export type CustomResizeDiagnostic = AdaptationDiagnostic;

export interface CustomResizeState {
    layers: Layer[];
    resizes: ResizeFormat[];
    activeResizeId: string;
    canvasWidth: number;
    canvasHeight: number;
}

export interface GenerateCustomResizeInput {
    id?: string;
    name: string;
    width: number;
    height: number;
}

export interface GenerateCustomResizeResult {
    resize: ResizeFormat;
    diagnostics: AdaptationDiagnostic[];
    sourceResizeId?: string;
}

function withAdaptationMetadata(
    resize: ResizeFormat,
    diagnostics: AdaptationDiagnostic[],
    adaptedFromResizeId?: string,
): ResizeFormat {
    return {
        ...resize,
        ...(diagnostics.length > 0 ? { adaptationDiagnostics: diagnostics } : {}),
        ...(adaptedFromResizeId ? { adaptedFromResizeId } : {}),
    };
}

interface SourceCandidate {
    resize: ResizeFormat;
    layers: Layer[];
    isActive: boolean;
}

interface CloneResult {
    layers: Layer[];
    idMap: Map<string, string>;
    reverseIdMap: Map<string, string>;
}

/**
 * Orchestrates «create new format» in the studio: source selection, clone,
 * `runAdaptationPipeline`, bindings, and adaptation metadata.
 */
export function generateCustomResize(
    state: CustomResizeState,
    input: GenerateCustomResizeInput,
): GenerateCustomResizeResult {
    const width = Math.max(1, Math.round(input.width));
    const height = Math.max(1, Math.round(input.height));
    const diagnostics: AdaptationDiagnostic[] = [];

    const source = selectSourceCandidate(state, { width, height });
    if (!source || source.layers.length === 0) {
        diagnostics.push({
            code: "no-source-layers",
            severity: "warning",
            message: "No source layers were available; created an empty custom format.",
        });
        return {
            resize: withAdaptationMetadata({
                id: input.id ?? `smart-${uuid()}`,
                name: input.name,
                width,
                height,
                label: `${width} × ${height}`,
                instancesEnabled: false,
                layerSnapshot: [],
            }, diagnostics),
            diagnostics,
        };
    }

    const sourceSize = { width: source.resize.width, height: source.resize.height };
    const targetSize = { width, height };
    const cloned = cloneLayerTreeWithMap(source.layers);
    const { layers: validated, diagnostics: pipelineDiagnostics } = runAdaptationPipeline(
        cloned.layers,
        sourceSize,
        targetSize,
        AdaptationPresets.full,
    );
    diagnostics.push(...pipelineDiagnostics);
    const master = resolveMasterFormat(state);
    const masterLayers = master ? getLayersForResize(state, master) : [];
    const layerBindings = master
        ? buildLayerBindings({
            generatedLayers: validated,
            sourceLayers: source.layers,
            sourceResize: source.resize,
            masterResize: master,
            masterLayers,
            reverseIdMap: cloned.reverseIdMap,
        })
        : [];

    return {
        resize: withAdaptationMetadata({
            id: input.id ?? `smart-${uuid()}`,
            name: input.name,
            width,
            height,
            label: `${width} × ${height}`,
            instancesEnabled: false,
            layerSnapshot: validated,
            ...(layerBindings.length > 0 ? { layerBindings } : {}),
        }, diagnostics, source.resize.id),
        diagnostics,
        sourceResizeId: source.resize.id,
    };
}

function selectSourceCandidate(
    state: CustomResizeState,
    target: ArtboardSize,
): SourceCandidate | null {
    const candidates = getSourceCandidates(state);
    if (candidates.length === 0) return null;

    const targetRatio = safeRatio(target);
    const targetArea = target.width * target.height;
    const targetOrientation = orientationOf(target);

    return candidates
        .slice()
        .sort((a, b) => {
            // Prefer a source of the same orientation (portrait/landscape/square)
            // so the layout type matches the target shape before we tune by ratio.
            const oriA = orientationOf(a.resize) === targetOrientation ? 0 : 1;
            const oriB = orientationOf(b.resize) === targetOrientation ? 0 : 1;
            if (oriA !== oriB) return oriA - oriB;

            const ratioA = Math.abs(Math.log(safeRatio(a.resize) / targetRatio));
            const ratioB = Math.abs(Math.log(safeRatio(b.resize) / targetRatio));
            if (Math.abs(ratioA - ratioB) > 0.0001) return ratioA - ratioB;

            const areaA = Math.abs(Math.log(safeArea(a.resize) / targetArea));
            const areaB = Math.abs(Math.log(safeArea(b.resize) / targetArea));
            if (Math.abs(areaA - areaB) > 0.0001) return areaA - areaB;

            if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
            return 0;
        })[0] ?? null;
}

function orientationOf(size: ArtboardSize): "portrait" | "landscape" | "square" {
    const ratio = safeRatio(size);
    if (ratio > 1.05) return "landscape";
    if (ratio < 0.95) return "portrait";
    return "square";
}

function getSourceCandidates(state: CustomResizeState): SourceCandidate[] {
    const activeResize = state.resizes.find((resize) => resize.id === state.activeResizeId);
    const fallbackActiveResize: ResizeFormat = activeResize ?? {
        id: state.activeResizeId || "active",
        name: "Active",
        width: state.canvasWidth,
        height: state.canvasHeight,
        label: `${state.canvasWidth} × ${state.canvasHeight}`,
        instancesEnabled: false,
    };
    const candidates: SourceCandidate[] = [];

    if (state.layers.length > 0) {
        candidates.push({
            resize: {
                ...fallbackActiveResize,
                width: fallbackActiveResize.width || state.canvasWidth,
                height: fallbackActiveResize.height || state.canvasHeight,
            },
            layers: state.layers,
            isActive: true,
        });
    }

    for (const resize of state.resizes) {
        if (resize.id === state.activeResizeId) continue;
        if (!resize.layerSnapshot || resize.layerSnapshot.length === 0) continue;
        candidates.push({ resize, layers: resize.layerSnapshot, isActive: false });
    }

    return candidates;
}

function safeRatio(size: ArtboardSize): number {
    return Math.max(0.0001, size.width) / Math.max(0.0001, size.height);
}

function safeArea(size: ArtboardSize): number {
    return Math.max(1, size.width * size.height);
}

function cloneLayerTreeWithMap(layers: Layer[]): CloneResult {
    const idMap = new Map<string, string>();
    for (const layer of layers) {
        idMap.set(layer.id, uuid());
    }

    const cloned = layers.map((layer) => {
        const newId = idMap.get(layer.id)!;
        const next = { ...layer, id: newId } as Layer & { parentId?: string };
        const maybeParentId = next.parentId;
        if (maybeParentId && idMap.has(maybeParentId)) {
            next.parentId = idMap.get(maybeParentId);
        }
        if (next.type === "frame") {
            (next as FrameLayer).childIds = (next as FrameLayer).childIds
                .map((childId) => idMap.get(childId) ?? childId)
                .filter(Boolean);
        }
        delete next.masterId;
        return next as Layer;
    });

    return {
        layers: cloned,
        idMap,
        reverseIdMap: new Map(Array.from(idMap.entries()).map(([oldId, newId]) => [newId, oldId])),
    };
}

function resolveMasterFormat(state: CustomResizeState): ResizeFormat | undefined {
    return state.resizes.find((resize) => resize.isMaster)
        ?? state.resizes.find((resize) => resize.id === "master")
        ?? state.resizes[0];
}

function getLayersForResize(state: CustomResizeState, resize: ResizeFormat): Layer[] {
    if (resize.id === state.activeResizeId) return state.layers;
    return resize.layerSnapshot ?? [];
}

function buildLayerBindings({
    generatedLayers,
    sourceLayers,
    sourceResize,
    masterResize,
    masterLayers,
    reverseIdMap,
}: {
    generatedLayers: Layer[];
    sourceLayers: Layer[];
    sourceResize: ResizeFormat;
    masterResize: ResizeFormat;
    masterLayers: Layer[];
    reverseIdMap: Map<string, string>;
}): LayerBinding[] {
    if (masterLayers.length === 0) return [];

    const masterById = new Map(masterLayers.map((layer) => [layer.id, layer]));
    const sourceById = new Map(sourceLayers.map((layer) => [layer.id, layer]));
    const sourceToMaster = new Map<string, string>();

    if (sourceResize.id === masterResize.id || sourceResize.isMaster) {
        for (const layer of sourceLayers) sourceToMaster.set(layer.id, layer.id);
    }
    for (const binding of sourceResize.layerBindings ?? []) {
        sourceToMaster.set(binding.targetLayerId, binding.masterLayerId);
    }
    for (const layer of sourceLayers) {
        if (layer.masterId) sourceToMaster.set(layer.id, layer.masterId);
    }

    const bindings: LayerBinding[] = [];
    for (const generatedLayer of generatedLayers) {
        const sourceId = reverseIdMap.get(generatedLayer.id);
        if (!sourceId) continue;

        const sourceLayer = sourceById.get(sourceId);
        const masterId = sourceToMaster.get(sourceId)
            ?? matchMasterLayer(sourceLayer ?? generatedLayer, masterLayers)?.id;
        if (!masterId || !masterById.has(masterId)) continue;

        bindings.push({
            masterLayerId: masterId,
            targetLayerId: generatedLayer.id,
            syncContent: true,
            syncStyle: true,
            syncSize: false,
            syncPosition: false,
            ...(generatedLayer.type === "image" ? { imageSyncMode: "content" as const } : {}),
        });
    }

    return bindings;
}

function matchMasterLayer(layer: Layer, masterLayers: Layer[]): Layer | undefined {
    const role = layer.responsive?.role || layer.slotId || layer.name;
    const exact = masterLayers.find((candidate) =>
        candidate.type === layer.type
        && (candidate.responsive?.role || candidate.slotId || candidate.name) === role
        && candidate.name === layer.name
    );
    if (exact) return exact;

    if (layer.slotId && layer.slotId !== "none") {
        return masterLayers.find((candidate) =>
            candidate.type === layer.type
            && candidate.slotId === layer.slotId
        );
    }

    return masterLayers.find((candidate) =>
        candidate.type === layer.type
        && candidate.name === layer.name
    );
}
