import { v4 as uuid } from "uuid";
import type {
    Project,
    MasterComponent,
    ResizeFormat,
    ComponentInstance,
    Layer,
    FrameLayer,
    SerializedLayerNode,
    BusinessUnit,
    TemplateCategory,
    ContentType,
    TemplateOccasion,
    TemplateTag,
    TemplateVisibility,
    TemplateEditPermission,
} from "@/types";
import type { RequiredFont } from "@/utils/fontUtils";

/* ─── Template Pack (v1 — backward compat) ──────────────── */
export interface TemplatePack {
    id: string;
    version: string;
    name: string;
    description: string;
    baseWidth: number;
    baseHeight: number;
    masterComponents: MasterComponent[];
    componentInstances?: ComponentInstance[];
    resizes: ResizeFormat[];
    /** v1.1+: serialized layer tree preserving frame→children nesting */
    layerTree?: SerializedLayerNode[];
    /** v1.2+: fonts required by this template (family + weights) */
    requiredFonts?: RequiredFont[];
}

/* ─── Template Pack V2 (with full catalogization) ───────── */
export interface TemplatePackV2 extends TemplatePack {
    // Catalogization
    businessUnits: BusinessUnit[];
    categories: TemplateCategory[];
    contentType: ContentType;
    occasion: TemplateOccasion;
    tags: TemplateTag[];

    // Metadata
    author: string;
    isOfficial: boolean;
    visibility?: TemplateVisibility;
    editPermission?: TemplateEditPermission;
    thumbnailUrl?: string;
    popularity: number;
    createdAt: string;
    updatedAt: string;
}

/* ─── Serialization ─────────────────────────────────────── */

/**
 * Serializes the current project state into a portable Template Pack.
 * Now includes layerTree to preserve frame→children nesting.
 */
export function serializeTemplate(
    project: Partial<Project>,
    masters: MasterComponent[],
    resizes: ResizeFormat[],
    instances?: ComponentInstance[],
    layers?: Layer[]
): TemplatePack {
    // Extract required fonts from layers if available
    let requiredFonts: RequiredFont[] | undefined;
    if (layers && layers.length > 0) {
        const { extractRequiredFonts } = require("@/utils/fontUtils") as typeof import("@/utils/fontUtils");
        requiredFonts = extractRequiredFonts(layers);
    }

    return {
        id: uuid(),
        version: "1.2.0",
        name: project.name || "Untitled Template",
        description: "Exported from AI Creative Platform",
        baseWidth: 1080,
        baseHeight: 1080,
        masterComponents: masters,
        componentInstances: instances,
        resizes: resizes.filter(r => r.id !== "master"),
        layerTree: layers ? buildLayerTree(layers) : undefined,
        requiredFonts,
    };
}

/**
 * Builds a serialized layer tree preserving frame→children nesting.
 * Only root-level layers (not nested inside any frame) appear at the top level.
 */
function buildLayerTree(layers: Layer[]): SerializedLayerNode[] {
    // Collect IDs of all children nested inside frames
    const childSet = new Set<string>();
    layers.forEach(l => {
        if (l.type === "frame") {
            (l as FrameLayer).childIds.forEach(cid => childSet.add(cid));
        }
    });

    // Only root-level layers (not children of any frame) at top level
    return layers
        .filter(l => !childSet.has(l.id))
        .map(l => serializeNode(l, layers));
}

function serializeNode(layer: Layer, allLayers: Layer[]): SerializedLayerNode {
    const node: SerializedLayerNode = {
        layer: { ...layer },
        masterId: layer.masterId,
    };

    if (layer.type === "frame") {
        const frame = layer as FrameLayer;
        node.children = frame.childIds
            .map(cid => allLayers.find(l => l.id === cid))
            .filter((l): l is Layer => !!l)
            .map(child => serializeNode(child, allLayers));
    }

    return node;
}

/* ─── Hydration ─────────────────────────────────────────── */

/**
 * Hydrates a Template Pack into a new Project state.
 * Regenerates IDs to avoid collisions.
 * If layerTree is present, also returns properly nested layers.
 */
export function hydrateTemplate(pack: TemplatePack): {
    masterComponents: MasterComponent[];
    componentInstances: ComponentInstance[];
    resizes: ResizeFormat[];
    layers?: Layer[];
    baseWidth: number;
    baseHeight: number;
} {
    const idMap = new Map<string, string>(); // Old Master ID -> New Master ID

    // 1. Regenerate Master IDs
    const newMasters = pack.masterComponents.map(m => {
        const newId = uuid();
        idMap.set(m.id, newId);
        return {
            ...m,
            id: newId,
            props: { ...m.props },
        };
    });

    const newResizes = pack.resizes.map(r => ({ ...r }));

    let newInstances: ComponentInstance[] = [];

    // 2. Hydrate provided instances OR regenerate defaults
    if (pack.componentInstances && pack.componentInstances.length > 0) {
        newInstances = pack.componentInstances.map(inst => {
            const newMasterId = idMap.get(inst.masterId);
            if (!newMasterId) return null;
            return {
                id: uuid(),
                masterId: newMasterId,
                resizeId: inst.resizeId,
                localProps: { ...inst.localProps },
            };
        }).filter((i): i is ComponentInstance => i !== null);
    } else {
        newResizes.forEach(resize => {
            newMasters.forEach(m => {
                newInstances.push({
                    id: uuid(),
                    masterId: m.id,
                    resizeId: resize.id,
                    localProps: { ...m.props },
                });
            });
        });
    }

    // 3. Hydrate layer tree if present
    let layers: Layer[] | undefined;
    let layerIdMap = new Map<string, string>();
    if (pack.layerTree && pack.layerTree.length > 0) {
        const result = hydrateLayerTree(pack.layerTree, idMap);
        layers = result.layers;
        layerIdMap = result.layerIdMap;
    }

    // 4. Update childIds in masterComponents and componentInstances
    if (layerIdMap.size > 0) {
        newMasters.forEach(m => {
            if (m.props.type === "frame" && (m.props as any).childIds) {
                (m.props as any).childIds = (m.props as any).childIds.map((cid: string) => layerIdMap.get(cid) || cid);
            }
        });

        newInstances.forEach(inst => {
            if (inst.localProps.type === "frame" && (inst.localProps as any).childIds) {
                (inst.localProps as any).childIds = (inst.localProps as any).childIds.map((cid: string) => layerIdMap.get(cid) || cid);
            }
        });
    }

    return {
        masterComponents: newMasters,
        componentInstances: newInstances,
        resizes: newResizes,
        layers,
        baseWidth: pack.baseWidth || 1080,
        baseHeight: pack.baseHeight || 1080,
    };
}

/**
 * Reconstructs flat layers array from serialized tree,
 * with proper frame.childIds set and new IDs generated.
 */
function hydrateLayerTree(
    nodes: SerializedLayerNode[],
    masterIdMap: Map<string, string>
): { layers: Layer[]; layerIdMap: Map<string, string> } {
    const layerIdMap = new Map<string, string>(); // Old Layer ID -> New Layer ID
    const allLayers: Layer[] = [];

    function processNode(node: SerializedLayerNode): string {
        const oldId = node.layer.id;
        const newId = uuid();
        layerIdMap.set(oldId, newId);

        // Map masterId if exists (fallback to node.layer.masterId for backward compat)
        const oldMasterId = node.masterId || node.layer.masterId;
        const newMasterId = oldMasterId
            ? masterIdMap.get(oldMasterId) || oldMasterId
            : undefined;

        const newLayer = {
            ...node.layer,
            id: newId,
            masterId: newMasterId,
        } as Layer;

        // Process children if this is a frame
        if (node.children && node.children.length > 0 && newLayer.type === "frame") {
            const childIds = node.children.map(child => processNode(child));
            (newLayer as FrameLayer).childIds = childIds;
        }

        allLayers.push(newLayer);
        return newId;
    }

    nodes.forEach(n => processNode(n));
    return { layers: allLayers, layerIdMap };
}

/* ─── Unified Loading Utility ───────────────────────────── */

/**
 * Apply content overrides to a flat layers array based on slotId.
 * Mutates layers in-place for efficiency.
 */
function applyContentOverridesToLayers(
    layers: any[],
    overrides: Record<string, string>
): void {
    for (const layer of layers) {
        if (layer.isFixedAsset) continue;
        const sid = layer.slotId as string | undefined;
        if (!sid || !overrides[sid]) continue;

        const value = overrides[sid];
        if (layer.type === "text") {
            layer.text = value;
        } else if (layer.type === "image") {
            layer.src = value;
        } else if (layer.type === "badge") {
            layer.label = value;
        }
    }
}

/**
 * Standardized function to apply a template pack across the App.
 * Safely extracts data (if wrapped in Meta), hydrates, and loads into CanvasStore.
 *
 * @param options.contentOverrides — map of slotId → value to inject before loading.
 *   For text slots: value = text string. For image slots: value = image URL.
 */
export async function applyTemplatePack(
    pack: TemplatePackV2 | { data: TemplatePackV2 },
    options?: {
        onSuccess?: () => void;
        onError?: (err: unknown) => void;
        contentOverrides?: Record<string, string>;
    }
) {
    try {
        const data = ('data' in pack) ? pack.data : pack; // Handle TemplatePackMeta wrapper if present
        const { useCanvasStore } = await import("@/store/canvasStore");
        const { applyAllAutoLayouts } = await import("@/utils/layoutEngine");
        const overrides = options?.contentOverrides;

        // If data is raw canvas state (saved from template editor), load directly.
        // This preserves layer hierarchy (parentId), slots, and all structure.
        // Raw canvas state has a `layers` array at the top level — TemplatePack format does not.
        const dataAny = data as any;
        if (dataAny.layers && Array.isArray(dataAny.layers) && dataAny.layers.length > 0) {
            const layers = dataAny.layers.map((l: any) => ({ ...l })); // shallow clone to avoid mutating original

            // Apply content overrides before loading
            if (overrides && Object.keys(overrides).length > 0) {
                applyContentOverridesToLayers(layers, overrides);
                const updatedLayers = applyAllAutoLayouts(layers);
                // We keep the original 'layers' reference semantics, but overwrite with updated
                layers.length = 0;
                layers.push(...updatedLayers);
            }

            const resizes = dataAny.resizes ?? [{ id: "master", name: "Мастер макет", width: dataAny.canvasWidth || 1080, height: dataAny.canvasHeight || 1080, label: `${dataAny.canvasWidth || 1080} × ${dataAny.canvasHeight || 1080}`, instancesEnabled: false }];

            // Find master format — prefer isMaster flag, then fall back to first resize
            const masterResize = resizes.find((r: any) => r.isMaster) || resizes[0];
            const activeResizeId = masterResize?.id || "master";

            // Apply content overrides to ALL format snapshots (for instance formats)
            if (overrides && Object.keys(overrides).length > 0) {
                for (const resize of resizes) {
                    if (resize.layerSnapshot && Array.isArray(resize.layerSnapshot)) {
                        resize.layerSnapshot = resize.layerSnapshot.map((l: any) => ({ ...l }));
                        applyContentOverridesToLayers(resize.layerSnapshot, overrides);
                        resize.layerSnapshot = applyAllAutoLayouts(resize.layerSnapshot);
                    }
                }
            }

            useCanvasStore.setState({
                layers,
                masterComponents: dataAny.masterComponents ?? [],
                componentInstances: dataAny.componentInstances ?? [],
                resizes,
                activeResizeId,
                selectedLayerIds: [],
                history: [],
                canvasWidth: masterResize?.width ?? dataAny.canvasWidth ?? 1080,
                canvasHeight: masterResize?.height ?? dataAny.canvasHeight ?? 1080,
                artboardProps: dataAny.artboardProps ?? useCanvasStore.getState().artboardProps,
            });
        } else {
            // Legacy TemplatePack format — hydrate with ID regeneration
            const hydrated = hydrateTemplate(data);

            // Apply content overrides to hydrated layers if present
            if (overrides && Object.keys(overrides).length > 0 && hydrated.layers) {
                applyContentOverridesToLayers(hydrated.layers, overrides);
                hydrated.layers = applyAllAutoLayouts(hydrated.layers);
            }

            // Also apply overrides to masterComponents (for instance generation path)
            if (overrides && Object.keys(overrides).length > 0) {
                for (const mc of hydrated.masterComponents) {
                    if ((mc.props as any).isFixedAsset) continue;
                    const sid = mc.slotId || (mc.props as any).slotId;
                    if (!sid || !overrides[sid]) continue;
                    const value = overrides[sid];
                    if (mc.type === "text") {
                        (mc.props as any).text = value;
                    } else if (mc.type === "image") {
                        (mc.props as any).src = value;
                    } else if (mc.type === "badge") {
                        (mc.props as any).label = value;
                    }
                }
            }

            useCanvasStore.getState().loadTemplatePack(hydrated);
        }

        options?.onSuccess?.();
    } catch (err) {
        console.error("Failed to apply template pack:", err);
        options?.onError?.(err);
    }
}

/**
 * Extracts a single format instance from a full template pack, turning it into a standalone master structure.
 */
export function extractSingleFormatFromPack(fullPack: TemplatePackV2, targetResizeId: string): TemplatePackV2 {
    const chosenResize = fullPack.resizes?.find((r: any) => r.id === targetResizeId);
    if (!chosenResize) return fullPack;

    const chosenInstances = fullPack.componentInstances?.filter((ci: any) => ci.resizeId === targetResizeId) || [];
    const newMasterComponents = fullPack.masterComponents.map((mc: any) => {
        const instance = chosenInstances.find((ci: any) => ci.masterId === mc.id);
        return instance ? { ...mc, props: instance.localProps as any } : mc;
    });

    return {
        ...fullPack,
        baseWidth: chosenResize.width,
        baseHeight: chosenResize.height,
        resizes: [], // Make it a strictly single format
        componentInstances: [],
        masterComponents: newMasterComponents
    };
}
