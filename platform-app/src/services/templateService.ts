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
} from "@/types";

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
    return {
        id: uuid(),
        version: "1.1.0",
        name: project.name || "Untitled Template",
        description: "Exported from AI Creative Platform",
        baseWidth: 1080,
        baseHeight: 1080,
        masterComponents: masters,
        componentInstances: instances,
        resizes: resizes.filter(r => r.id !== "master"),
        layerTree: layers ? buildLayerTree(layers) : undefined,
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
    if (pack.layerTree && pack.layerTree.length > 0) {
        layers = hydrateLayerTree(pack.layerTree, idMap);
    }

    return {
        masterComponents: newMasters,
        componentInstances: newInstances,
        resizes: newResizes,
        layers,
    };
}

/**
 * Reconstructs flat layers array from serialized tree,
 * with proper frame.childIds set and new IDs generated.
 */
function hydrateLayerTree(
    nodes: SerializedLayerNode[],
    masterIdMap: Map<string, string>
): Layer[] {
    const layerIdMap = new Map<string, string>(); // Old Layer ID -> New Layer ID
    const allLayers: Layer[] = [];

    function processNode(node: SerializedLayerNode): string {
        const oldId = node.layer.id;
        const newId = uuid();
        layerIdMap.set(oldId, newId);

        // Map masterId if exists
        const newMasterId = node.masterId
            ? masterIdMap.get(node.masterId) || node.masterId
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
    return allLayers;
}
