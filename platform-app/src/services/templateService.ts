import { v4 as uuid } from "uuid";
import type {
    Project,
    MasterComponent,
    ResizeFormat,
    ComponentInstance,
    Template,
    TemplateSlot
} from "@/types";

export interface TemplatePack {
    id: string; // Unique ID for saved packs
    version: string;
    name: string;
    description: string;
    baseWidth: number;
    baseHeight: number;
    masterComponents: MasterComponent[]; // Defines the structure & slots
    componentInstances?: ComponentInstance[]; // Optional: Pre-defined instances with specific layouts
    resizes: ResizeFormat[]; // Defines the target formats to include
}

/**
 * Serializes the current project state into a portable Template Pack.
 * Strips out specific IDs to ensure clean import.
 */
export function serializeTemplate(
    project: Partial<Project>,
    masters: MasterComponent[],
    resizes: ResizeFormat[],
    instances?: ComponentInstance[] // Optional allow export of instances
): TemplatePack {
    return {
        id: uuid(),
        version: "1.0.0",
        name: project.name || "Untitled Template",
        description: "Exported from AI Creative Platform",
        baseWidth: 1080,
        baseHeight: 1080,
        masterComponents: masters,
        componentInstances: instances,
        resizes: resizes.filter(r => r.id !== "master"),
    };
}

/**
 * Hydrates a Template Pack into a new Project state.
 * Regenerates IDs to avoid collisions.
 */
export function hydrateTemplate(pack: TemplatePack): {
    masterComponents: MasterComponent[];
    componentInstances: ComponentInstance[];
    resizes: ResizeFormat[];
} {
    const idMap = new Map<string, string>(); // Old Master ID -> New Master ID

    // 1. Regenerate Master IDs
    const newMasters = pack.masterComponents.map(m => {
        const newId = uuid();
        idMap.set(m.id, newId);
        return {
            ...m,
            id: newId,
            props: {
                ...m.props
            }
        };
    });

    const newResizes = pack.resizes.map(r => ({ ...r }));

    let newInstances: ComponentInstance[] = [];

    // 2. Hydrate provided instances OR regenerate defaults
    if (pack.componentInstances && pack.componentInstances.length > 0) {
        newInstances = pack.componentInstances.map(inst => {
            const newMasterId = idMap.get(inst.masterId);
            if (!newMasterId) return null; // Orphan instance

            // If resize is not in newResizes? We assume pack consistency.

            return {
                id: uuid(),
                masterId: newMasterId,
                resizeId: inst.resizeId, // Keep resize ID matches
                localProps: { ...inst.localProps }
            };
        }).filter((i): i is ComponentInstance => i !== null);
    } else {
        // Fallback: Generate default instances
        newResizes.forEach(resize => {
            newMasters.forEach(m => {
                newInstances.push({
                    id: uuid(),
                    masterId: m.id,
                    resizeId: resize.id,
                    localProps: { ...m.props }
                });
            });
        });
    }

    return {
        masterComponents: newMasters,
        componentInstances: newInstances,
        resizes: newResizes
    };
}
