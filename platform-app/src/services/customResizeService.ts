import { v4 as uuid } from "uuid";
import {
    DEFAULT_CONSTRAINTS,
    type FrameLayer,
    type Layer,
    type LayerBinding,
    type LayerConstraints,
    type ResizeFormat,
    type TextLayer,
} from "@/types";
import { computeConstrainedPosition } from "@/store/canvas/helpers";
import { applyAllAutoLayouts, measureTextLayer } from "@/utils/layoutEngine";
import { applyTextContainerLimits } from "@/utils/textContainerLimits";
import { shrinkTextToFitBox } from "@/utils/textFit";
import { resolveConstraints, type Box } from "@/utils/constraintInference";

export type CustomResizeDiagnosticCode =
    | "no-source-layers"
    | "invalid-layer-geometry"
    | "layer-out-of-bounds";

export interface CustomResizeDiagnostic {
    code: CustomResizeDiagnosticCode;
    severity: "warning";
    message: string;
    layerId?: string;
    layerName?: string;
}

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
    diagnostics: CustomResizeDiagnostic[];
    sourceResizeId?: string;
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

interface ArtboardSize {
    width: number;
    height: number;
}

const GEOMETRY_EPSILON = 1;

export function generateCustomResize(
    state: CustomResizeState,
    input: GenerateCustomResizeInput,
): GenerateCustomResizeResult {
    const width = Math.max(1, Math.round(input.width));
    const height = Math.max(1, Math.round(input.height));
    const diagnostics: CustomResizeDiagnostic[] = [];

    const source = selectSourceCandidate(state, { width, height });
    if (!source || source.layers.length === 0) {
        diagnostics.push({
            code: "no-source-layers",
            severity: "warning",
            message: "No source layers were available; created an empty custom format.",
        });
        return {
            resize: {
                id: input.id ?? `smart-${uuid()}`,
                name: input.name,
                width,
                height,
                label: `${width} × ${height}`,
                instancesEnabled: false,
                layerSnapshot: [],
            },
            diagnostics,
        };
    }

    const sourceSize = { width: source.resize.width, height: source.resize.height };
    const targetSize = { width, height };
    const cloned = cloneLayerTreeWithMap(source.layers);
    const projected = projectTree(cloned.layers, sourceSize, targetSize);
    // Pass the projected layers as the baseline so the auto-layout pass repacks
    // auto-layout frames without the constraint cascade re-projecting the
    // non-auto children we just positioned in projectTree.
    const layouted = preserveStretchedRootAutoLayoutGeometry(
        projected,
        applyAllAutoLayouts(projected),
    );
    const remeasured = applyTextFitShrink(applyTextContainerLimitsToLayers(remeasureAdaptedTextBoxes(layouted)));
    const validated = validateAndApplyHide(remeasured, targetSize, diagnostics);
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
        resize: {
            id: input.id ?? `smart-${uuid()}`,
            name: input.name,
            width,
            height,
            label: `${width} × ${height}`,
            instancesEnabled: false,
            layerSnapshot: validated,
            ...(layerBindings.length > 0 ? { layerBindings } : {}),
        },
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

/**
 * Projects an ENTIRE layer tree from a source artboard to a target artboard.
 *
 * Root layers are projected against the artboard (honouring background/fluid/
 * fixed behaviours, otherwise explicit-or-inferred constraints). Children of
 * NON-auto-layout frames are then projected recursively against their parent
 * frame's old→new box, so nested content adapts instead of clinging to the
 * top-left. Auto-layout frames keep their children untouched here — they are
 * repacked afterwards by `applyAllAutoLayouts`.
 */
export function projectTree(
    layers: Layer[],
    sourceSize: ArtboardSize,
    targetSize: ArtboardSize,
    options: { scaleFonts?: boolean } = {},
): Layer[] {
    const scaleFonts = options.scaleFonts ?? true;
    const sizeUnchanged =
        Math.abs(sourceSize.width - targetSize.width) < 0.01 &&
        Math.abs(sourceSize.height - targetSize.height) < 0.01;
    if (sizeUnchanged) return layers;

    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    const childIdSet = new Set<string>();
    for (const layer of layers) {
        if (layer.type === "frame") {
            for (const childId of (layer as FrameLayer).childIds) childIdSet.add(childId);
        }
        const parentId = (layer as Layer & { parentId?: string }).parentId;
        if (parentId) childIdSet.add(layer.id);
    }

    const newGeom = new Map<string, Pick<Layer, "x" | "y" | "width" | "height">>();

    // 1. Roots — projected against the artboard.
    for (const layer of layers) {
        if (childIdSet.has(layer.id)) continue;
        newGeom.set(layer.id, projectRootRect(layer, sourceSize, targetSize));
    }

    // 2. Non-auto-layout frame children — projected against the parent frame.
    const projectChildren = (frameId: string, oldBox: Box, newBox: Box) => {
        const frame = byId.get(frameId);
        if (!frame || frame.type !== "frame") return;
        if (frame.layoutMode && frame.layoutMode !== "none") return; // auto-layout repacks later

        const delta = {
            oldX: oldBox.x, oldY: oldBox.y, oldWidth: oldBox.width, oldHeight: oldBox.height,
            newX: newBox.x, newY: newBox.y, newWidth: newBox.width, newHeight: newBox.height,
        };

        for (const childId of (frame as FrameLayer).childIds) {
            const child = byId.get(childId);
            if (!child) continue;
            const childOld: Box = { x: child.x, y: child.y, width: child.width, height: child.height };
            const constraints = adaptationConstraints(child, oldBox);
            const projected = computeConstrainedPosition({ ...childOld, constraints }, delta);
            newGeom.set(childId, projected);
            if (child.type === "frame") {
                projectChildren(childId, childOld, projected);
            }
        }
    };

    for (const layer of layers) {
        if (childIdSet.has(layer.id) || layer.type !== "frame") continue;
        const oldBox: Box = { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
        const ng = newGeom.get(layer.id);
        if (!ng) continue;
        projectChildren(layer.id, oldBox, { x: ng.x, y: ng.y, width: ng.width, height: ng.height });
    }

    const fontScale = getScale(sourceSize, targetSize).font;

    // 3. Scale auto-layout padding/spacing with the artboard so inner gaps stay
    // proportional across formats (horizontal pad/spacing by width ratio,
    // vertical by height ratio). Only on the adaptation path, never interactive.
    const padScaleX = targetSize.width / Math.max(1, sourceSize.width);
    const padScaleY = targetSize.height / Math.max(1, sourceSize.height);
    const padOverrides = new Map<string, Partial<FrameLayer>>();
    for (const layer of layers) {
        if (layer.type !== "frame") continue;
        const frame = layer as FrameLayer;
        if (!frame.layoutMode || frame.layoutMode === "none") continue;
        const horizontal = frame.layoutMode === "horizontal";
        const o: Partial<FrameLayer> = {};
        if (typeof frame.paddingLeft === "number") o.paddingLeft = round2(frame.paddingLeft * padScaleX);
        if (typeof frame.paddingRight === "number") o.paddingRight = round2(frame.paddingRight * padScaleX);
        if (typeof frame.paddingTop === "number") o.paddingTop = round2(frame.paddingTop * padScaleY);
        if (typeof frame.paddingBottom === "number") o.paddingBottom = round2(frame.paddingBottom * padScaleY);
        if (typeof frame.spacing === "number") o.spacing = round2(frame.spacing * (horizontal ? padScaleX : padScaleY));
        padOverrides.set(layer.id, o);
    }

    return layers.map((layer) => {
        const geom = newGeom.get(layer.id);
        const pad = padOverrides.get(layer.id);
        const next = (geom || pad) ? ({ ...layer, ...geom, ...pad } as Layer) : layer;
        return scaleFonts ? scaleFontIfNeeded(next, layer, fontScale) : next;
    });
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/** Keep projected stretch geometry on root hug auto-layout frames after repack. */
function preserveStretchedRootAutoLayoutGeometry(
    projected: Layer[],
    layouted: Layer[],
): Layer[] {
    const projectedById = new Map(projected.map((layer) => [layer.id, layer]));
    const childIdSet = new Set<string>();
    for (const layer of layouted) {
        if (layer.type !== "frame") continue;
        for (const childId of (layer as FrameLayer).childIds) childIdSet.add(childId);
    }

    return layouted.map((layer) => {
        if (childIdSet.has(layer.id) || layer.type !== "frame") return layer;
        const frame = layer as FrameLayer;
        if (!frame.layoutMode || frame.layoutMode === "none") return layer;
        const constraints = frame.constraints;
        if (constraints?.horizontal !== "stretch" || constraints?.vertical !== "stretch") {
            return layer;
        }
        const source = projectedById.get(layer.id);
        if (!source) return layer;
        return {
            ...layer,
            x: source.x,
            y: source.y,
            width: source.width,
            height: source.height,
        };
    });
}

/**
 * Constraints used on the adaptation path. Identical to `resolveConstraints`,
 * except an auto-layout frame whose `layoutSizingWidth/Height` is "fill" is
 * forced to stretch on that axis so it fills its parent (artboard or enclosing
 * frame) instead of pinning to an inferred edge.
 */
function adaptationConstraints(
    layer: Layer,
    parent: Box,
): LayerConstraints {
    const base = resolveConstraints(layer, parent);
    if (layer.type !== "frame") return base;
    const frame = layer as FrameLayer;
    if (!frame.layoutMode || frame.layoutMode === "none") return base;
    return {
        horizontal: frame.layoutSizingWidth === "fill"
            ? "stretch"
            : frame.layoutSizingWidth === "hug"
                ? "scale"
                : base.horizontal,
        vertical: frame.layoutSizingHeight === "fill"
            ? "stretch"
            : frame.layoutSizingHeight === "hug"
                ? "scale"
                : base.vertical,
    };
}

function getScale(sourceSize: ArtboardSize, targetSize: ArtboardSize) {
    const scaleX = targetSize.width / Math.max(1, sourceSize.width);
    const scaleY = targetSize.height / Math.max(1, sourceSize.height);
    return {
        x: scaleX,
        y: scaleY,
        font: Math.sqrt(scaleX * scaleY),
    };
}

function projectRootRect(
    layer: Layer,
    sourceSize: ArtboardSize,
    targetSize: ArtboardSize,
): Pick<Layer, "x" | "y" | "width" | "height"> {
    const behavior = layer.responsive?.behavior ?? "auto";
    const scale = getScale(sourceSize, targetSize);

    if (behavior === "background") {
        return { x: 0, y: 0, width: targetSize.width, height: targetSize.height };
    }

    if (behavior === "fluid") {
        return {
            x: layer.x * scale.x,
            y: layer.y * scale.y,
            width: layer.width * scale.x,
            height: layer.height * scale.y,
        };
    }

    if (behavior === "fixed") {
        return computeFixedPosition(layer, sourceSize, targetSize);
    }

    // auto / unset — explicit constraints win, otherwise infer
    // from geometry so default adaptation is sensible.
    const artboardOld: Box = { x: 0, y: 0, width: sourceSize.width, height: sourceSize.height };
    const constraints = adaptationConstraints(layer, artboardOld);
    return computeConstrainedPosition(
        { x: layer.x, y: layer.y, width: layer.width, height: layer.height, constraints },
        {
            oldX: 0,
            oldY: 0,
            oldWidth: sourceSize.width,
            oldHeight: sourceSize.height,
            newX: 0,
            newY: 0,
            newWidth: targetSize.width,
            newHeight: targetSize.height,
        },
    );
}

function computeFixedPosition(
    layer: Pick<Layer, "x" | "y" | "width" | "height" | "constraints">,
    sourceSize: ArtboardSize,
    targetSize: ArtboardSize,
): Pick<Layer, "x" | "y" | "width" | "height"> {
    const constraints = layer.constraints ?? DEFAULT_CONSTRAINTS;
    return {
        x: computeFixedAxis(
            layer.x,
            layer.width,
            sourceSize.width,
            targetSize.width,
            constraints.horizontal,
        ),
        y: computeFixedAxis(
            layer.y,
            layer.height,
            sourceSize.height,
            targetSize.height,
            constraints.vertical,
        ),
        width: layer.width,
        height: layer.height,
    };
}

function computeFixedAxis(
    start: number,
    size: number,
    sourceAxis: number,
    targetAxis: number,
    constraint: LayerConstraints["horizontal"] | LayerConstraints["vertical"],
): number {
    if (constraint === "right" || constraint === "bottom") {
        const endGap = sourceAxis - (start + size);
        return targetAxis - endGap - size;
    }
    if (constraint === "center") {
        const centerRatio = (start + size / 2) / Math.max(1, sourceAxis);
        return centerRatio * targetAxis - size / 2;
    }
    if (constraint === "scale") {
        return start * (targetAxis / Math.max(1, sourceAxis));
    }
    return start;
}

function applyTextContainerLimitsToLayers(layers: Layer[]): Layer[] {
    return layers.map((layer) => (
        layer.type === "text" ? applyTextContainerLimits(layer as TextLayer) : layer
    ));
}

function applyTextFitShrink(layers: Layer[]): Layer[] {
    return layers.map((layer) => (
        layer.type === "text" ? shrinkTextToFitBox(layer as TextLayer) : layer
    ));
}

/** Re-sync text container boxes after font scaling on the adaptation path. */
function remeasureAdaptedTextBoxes(layers: Layer[]): Layer[] {
    return layers.map((layer) => {
        if (layer.type !== "text") return layer;
        const text = layer as TextLayer;
        const adj = text.textAdjust ?? "auto_width";

        if (adj === "auto_width") {
            const size = measureTextLayer(text);
            return { ...text, width: size.width, height: size.height };
        }
        if (adj === "auto_height") {
            const size = measureTextLayer(text, text.width);
            return { ...text, height: size.height };
        }

        const size = measureTextLayer(text, text.width);
        return { ...text, height: size.height };
    });
}

function scaleFontIfNeeded(layer: Layer, base: Layer, fontScale: number): Layer {
    if (layer.responsive?.behavior === "fixed") return layer;

    if (layer.type !== "text" && layer.type !== "badge") return layer;
    const baseFontSize = base.type === layer.type && "fontSize" in base
        ? base.fontSize
        : layer.fontSize;
    const minFontSize = layer.responsive?.minFontSize ?? 8;
    const maxFontSize = layer.responsive?.maxFontSize;
    const nextFontSize = clamp(
        baseFontSize * fontScale,
        minFontSize,
        maxFontSize,
    );

    if (Math.abs(nextFontSize - layer.fontSize) < 0.01) return layer;
    return { ...layer, fontSize: Math.round(nextFontSize * 100) / 100 } as Layer;
}

function clamp(value: number, min: number, max: number | undefined): number {
    const lower = Math.max(min, value);
    return typeof max === "number" && Number.isFinite(max)
        ? Math.min(max, lower)
        : lower;
}

function validateAndApplyHide(
    layers: Layer[],
    targetSize: ArtboardSize,
    diagnostics: CustomResizeDiagnostic[],
): Layer[] {
    let changed = false;
    const nextLayers = layers.map((layer) => {
        const diagnostic = getLayerDiagnostic(layer, targetSize);
        if (!diagnostic) return layer;

        diagnostics.push(diagnostic);
        if (layer.responsive?.canHide) {
            changed = true;
            return { ...layer, visible: false } as Layer;
        }
        return layer;
    });

    return changed ? nextLayers : layers;
}

function getLayerDiagnostic(layer: Layer, targetSize: ArtboardSize): CustomResizeDiagnostic | null {
    const hasInvalidGeometry = ![layer.x, layer.y, layer.width, layer.height].every(Number.isFinite)
        || layer.width <= 0
        || layer.height <= 0;
    if (hasInvalidGeometry) {
        return {
            code: "invalid-layer-geometry",
            severity: "warning",
            layerId: layer.id,
            layerName: layer.name,
            message: `Layer "${layer.name}" has invalid geometry after resize generation.`,
        };
    }

    if (layer.responsive?.behavior === "background") return null;

    const outOfBounds =
        layer.x < -GEOMETRY_EPSILON ||
        layer.y < -GEOMETRY_EPSILON ||
        layer.x + layer.width > targetSize.width + GEOMETRY_EPSILON ||
        layer.y + layer.height > targetSize.height + GEOMETRY_EPSILON;

    if (!outOfBounds) return null;
    return {
        code: "layer-out-of-bounds",
        severity: "warning",
        layerId: layer.id,
        layerName: layer.name,
        message: `Layer "${layer.name}" extends outside the generated artboard.`,
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
