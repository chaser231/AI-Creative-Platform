import { v4 as uuid } from "uuid";
import type {
    ComponentInstance,
    ComponentProps,
    ComponentType,
    Layer,
    MasterComponent,
    ResizeFormat,
} from "@/types";
import { CONTENT_SOURCE_KEYS } from "@/types";
import type { TemplatePack } from "@/services/templateService";
import type { SlotMapping } from "@/services/slotMappingService";
import { AdaptationPresets, runAdaptationPipeline } from "@/services/adaptationPipeline";
import { cloneLayerTree } from "@/utils/cloneLayerTree";

export interface TemplateAdaptationResult {
    resizes: ResizeFormat[];
    instances: ComponentInstance[];
    unmappedSlotNames: string[];
}

/** Modern packs saved with `layers[]` use the layer-based adaptation pipeline. */
export function supportsSnapshotAdaptation(pack: TemplatePack): boolean {
    return Array.isArray(pack.layers) && pack.layers.length > 0;
}

/**
 * Inventory helper: classify how a template pack would be adapted via SlotMapping.
 */
export function describeTemplatePackAdaptationMode(pack: TemplatePack): "snapshot-pipeline" | "legacy-instances" {
    return supportsSnapshotAdaptation(pack) ? "snapshot-pipeline" : "legacy-instances";
}

/**
 * SlotMapping entry point. Snapshot packs → pipeline + layerSnapshot formats.
 * Legacy packs → master/instance instances (shim until packs are migrated).
 */
export function generateTemplateResizes(
    currentMasters: MasterComponent[],
    currentLayers: Layer[],
    masterSize: { width: number; height: number },
    templatePack: TemplatePack,
    mappings: SlotMapping[],
): TemplateAdaptationResult {
    if (supportsSnapshotAdaptation(templatePack)) {
        return generateSnapshotTemplateResizes(currentLayers, masterSize, templatePack, mappings);
    }
    return generateLegacyTemplateResizes(currentMasters, templatePack, mappings);
}

function generateSnapshotTemplateResizes(
    masterLayers: Layer[],
    masterSize: { width: number; height: number },
    templatePack: TemplatePack,
    mappings: SlotMapping[],
): TemplateAdaptationResult {
    const templateMasters = templatePack.masterComponents;
    const mappedTemplateIds = new Set(mappings.map((m) => m.templateMasterId));
    const unmappedSlotNames = templateMasters
        .filter((tm) => !mappedTemplateIds.has(tm.id))
        .map((tm) => tm.name);

    const templateResizes = templatePack.resizes.filter((r) => r.id !== "master");
    const resizes: ResizeFormat[] = [];

    for (const templateResize of templateResizes) {
        const cloned = cloneLayerTree(masterLayers);
        const { layers, diagnostics } = runAdaptationPipeline(
            cloned,
            masterSize,
            { width: templateResize.width, height: templateResize.height },
            AdaptationPresets.full,
        );

        resizes.push({
            ...templateResize,
            instancesEnabled: false,
            layerSnapshot: layers,
            ...(diagnostics.length > 0 ? { adaptationDiagnostics: diagnostics } : {}),
        });
    }

    return {
        resizes,
        instances: [],
        unmappedSlotNames,
    };
}

/* ─── Legacy master/instance shim (migrated from smartResizeService) ─── */

function extractContentSource(master: MasterComponent): Record<string, unknown> {
    const keys = CONTENT_SOURCE_KEYS[master.type] || [];
    const result: Record<string, unknown> = {};
    const props = master.props as unknown as Record<string, unknown>;
    for (const key of keys) {
        result[key] = props[key];
    }
    return result;
}

function generateLegacyTemplateResizes(
    currentMasters: MasterComponent[],
    templatePack: TemplatePack,
    mappings: SlotMapping[],
): TemplateAdaptationResult {
    const templateMasters = templatePack.masterComponents;
    const templateInstances = templatePack.componentInstances || [];
    const templateResizes = templatePack.resizes.filter((r) => r.id !== "master");

    const newInstances: ComponentInstance[] = [];
    const mappedTemplateIds = new Set(mappings.map((m) => m.templateMasterId));

    const unmappedSlotNames = templateMasters
        .filter((tm) => !mappedTemplateIds.has(tm.id))
        .map((tm) => tm.name);

    for (const resize of templateResizes) {
        for (const mapping of mappings) {
            const currentMaster = currentMasters.find((m) => m.id === mapping.masterId);
            const templateMaster = templateMasters.find((m) => m.id === mapping.templateMasterId);
            if (!currentMaster || !templateMaster) continue;

            const templateInstance = templateInstances.find(
                (i) => i.resizeId === resize.id && i.masterId === mapping.templateMasterId,
            );

            let layoutProps: ComponentProps;

            if (templateInstance) {
                layoutProps = { ...templateInstance.localProps };
            } else {
                layoutProps = scalePropsToResize(
                    templateMaster.props,
                    templatePack.baseWidth,
                    templatePack.baseHeight,
                    resize.width,
                    resize.height,
                );
            }

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

function scalePropsToResize(
    props: ComponentProps,
    fromWidth: number,
    fromHeight: number,
    toWidth: number,
    toHeight: number,
): ComponentProps {
    const scaleX = toWidth / fromWidth;
    const scaleY = toHeight / fromHeight;
    const scale = Math.min(scaleX, scaleY);

    return {
        ...props,
        x: props.x * scaleX,
        y: props.y * scaleY,
        width: props.width * scale,
        height: props.height * scale,
    };
}
