import { v4 as uuid } from "uuid";
import type {
    MasterComponent,
    ComponentInstance,
    ComponentProps,
    ResizeFormat,
    ComponentType,
} from "@/types";
import { CONTENT_SOURCE_KEYS } from "@/types";
import type { TemplatePack } from "@/services/templateService";
import type { SlotMapping } from "@/services/slotMappingService";

/* ─── Types ──────────────────────────────────────────────── */

export interface SmartResizeResult {
    /** New resizes to add (from template, skipping master) */
    resizes: ResizeFormat[];
    /** New instances mapping current master content → template positions */
    instances: ComponentInstance[];
    /** Template slots that have no mapped master (user should address these) */
    unmappedSlotNames: string[];
}

/* ─── Content source extraction ──────────────────────────── */

/**
 * Extract content-source properties from a master component.
 * These are the values that cascade from master to instances.
 */
function extractContentSource(master: MasterComponent): Record<string, unknown> {
    const keys = CONTENT_SOURCE_KEYS[master.type] || [];
    const result: Record<string, unknown> = {};
    const props = master.props as unknown as Record<string, unknown>;
    for (const key of keys) {
        result[key] = props[key];
    }
    return result;
}

/* ─── Smart Resize generation ────────────────────────────── */

/**
 * Generates instances for each resize in the template pack,
 * using **positions** from the template and **content** from current masters.
 *
 * For each (resize × mapping):
 *   1. Find the template's ComponentInstance for that resize + templateMasterId
 *   2. Take its localProps (x, y, width, height, rotation, etc.) — the LAYOUT
 *   3. Overlay CONTENT_SOURCE_KEYS from the current master — the CONTENT
 *   4. Create a new ComponentInstance linked to the current master
 *
 * If no instance exists in the template for a given resize+master pair,
 * fall back to proportional scaling from the template's master props.
 */
export function generateSmartResizes(
    currentMasters: MasterComponent[],
    templatePack: TemplatePack,
    mappings: SlotMapping[],
): SmartResizeResult {
    const templateMasters = templatePack.masterComponents;
    const templateInstances = templatePack.componentInstances || [];
    // Template resizes (exclude "master" — we keep the user's own master)
    const templateResizes = templatePack.resizes.filter(r => r.id !== "master");

    const newInstances: ComponentInstance[] = [];
    const mappedTemplateIds = new Set(mappings.map(m => m.templateMasterId));

    // Collect unmapped template slots
    const unmappedSlotNames = templateMasters
        .filter(tm => !mappedTemplateIds.has(tm.id))
        .map(tm => tm.name);

    for (const resize of templateResizes) {
        for (const mapping of mappings) {
            const currentMaster = currentMasters.find(m => m.id === mapping.masterId);
            const templateMaster = templateMasters.find(m => m.id === mapping.templateMasterId);
            if (!currentMaster || !templateMaster) continue;

            // Find template instance for this resize + template master
            const templateInstance = templateInstances.find(
                i => i.resizeId === resize.id && i.masterId === mapping.templateMasterId
            );

            // Base layout: from template instance or scaled from template master
            let layoutProps: ComponentProps;

            if (templateInstance) {
                // Use the template instance's localProps (exact positions for this resize)
                layoutProps = { ...templateInstance.localProps };
            } else {
                // Fallback: proportionally scale template master props to this resize
                layoutProps = scalePropsToResize(
                    templateMaster.props,
                    templatePack.baseWidth,
                    templatePack.baseHeight,
                    resize.width,
                    resize.height,
                );
            }

            // Overlay content from the current master
            const contentSource = extractContentSource(currentMaster);
            const finalProps = { ...layoutProps, ...contentSource } as ComponentProps;

            newInstances.push({
                id: uuid(),
                masterId: currentMaster.id,
                resizeId: resize.id,
                localProps: finalProps,
            });
        }
    }

    return {
        resizes: templateResizes,
        instances: newInstances,
        unmappedSlotNames,
    };
}

/* ─── Proportional scaling fallback ──────────────────────── */

function scalePropsToResize(
    props: ComponentProps,
    fromWidth: number,
    fromHeight: number,
    toWidth: number,
    toHeight: number,
): ComponentProps {
    const scaleX = toWidth / fromWidth;
    const scaleY = toHeight / fromHeight;
    const scale = Math.min(scaleX, scaleY); // uniform scale

    return {
        ...props,
        x: props.x * scaleX,
        y: props.y * scaleY,
        width: props.width * scale,
        height: props.height * scale,
    };
}
