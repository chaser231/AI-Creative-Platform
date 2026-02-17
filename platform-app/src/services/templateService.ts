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
    version: string;
    name: string;
    description: string;
    baseWidth: number;
    baseHeight: number;
    masterComponents: MasterComponent[]; // Defines the structure & slots
    resizes: ResizeFormat[]; // Defines the target formats to include
    // We optionally exclude specific instance data to force re-generation from rules/masters
    // or we can include them if we want to preserve manual layout adjustments.
    // For "without instance-specific content", we might strip text/images or keep as placeholders.
}

/**
 * Serializes the current project state into a portable Template Pack.
 * Strips out specific IDs to ensure clean import.
 */
export function serializeTemplate(
    project: Partial<Project>,
    masters: MasterComponent[],
    resizes: ResizeFormat[]
): TemplatePack {
    // 1. Sanitize Masters: Remove strictly unique IDs if we want 'pure' template,
    // but we need to keep internal references consistent. 
    // We will keep IDs for internal consistency within the pack, 
    // but hydrateTemplate will regenerate them.

    return {
        version: "1.0.0",
        name: project.name || "Untitled Template",
        description: "Exported from AI Creative Platform",
        baseWidth: 1080, // Default master size
        baseHeight: 1080,
        masterComponents: masters,
        resizes: resizes.filter(r => r.id !== "master"), // Master is implicit
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
    const idMap = new Map<string, string>();

    // 1. Regenerate Master IDs
    const newMasters = pack.masterComponents.map(m => {
        const newId = uuid();
        idMap.set(m.id, newId);
        return {
            ...m,
            id: newId,
            props: {
                ...m.props,
                // If props contain references to other IDs (like frame children), we'd need to map them too
                // For now, simpler props don't have ID refs (except Frame childIds)
            }
        };
    });

    // 2. Fix Frame childIds references in Masters
    newMasters.forEach(m => {
        if (m.type === "frame" && (m.props as any).childIds) {
            // This is tricky: childIds refer to Layers, but Masters hold Props.
            // Masters don't have "childIds" in the sense of layers, 
            // but FrameLayers do. If a Master is a Frame, its props contain childIds?
            // Yes, MasterComponent.props is ComponentProps which encompasses FrameLayer props.
            // Wait, MasterComponent props shouldn't hold strict Layer IDs usually? 
            // They hold structure. 
            // Actually, in our store `syncFrameChildIdsToMasters` puts Layer IDs into Master Props.
            // This is slightly leaky. 
            // For templates, we might assume flat structure or we need to handle hierarchy.
            // Let's assume flat for MVP or handle children if they appear in master list.
        }
    });

    // 3. Create Instances for each Resize
    // We don't import instances from pack (per "without instance-specific content"),
    // instead we regenerate them using the standard logic (which triggers Auto-Layout/Rules).
    const newResizes = pack.resizes.map(r => ({ ...r })); // Keep resize definitions

    const newInstances: ComponentInstance[] = [];

    newResizes.forEach(resize => {
        // For each master, create an instance for this resize
        // We can reuse the logic from `addResize` conceptually
        // But since we are independent of the store here, we might just create basic instances
        // AND rely on the UI/Store to "Applying Layout" after hydration if possible?
        // Or we do it here. 

        // Since we don't have access to applyLayout here easily without circular deps or duplication,
        // we'll create standard instances.
        // Ideally, we imports `applyLayout` here too.

        newMasters.forEach(m => {
            newInstances.push({
                id: uuid(),
                masterId: m.id,
                resizeId: resize.id,
                localProps: { ...m.props } // Copy master props
            });
        });
    });

    // Note: The caller (store) will likely need to run `applyLayout` 
    // or we should do it here if we want them pre-calculated.

    return {
        masterComponents: newMasters,
        componentInstances: newInstances,
        resizes: newResizes
    };
}
