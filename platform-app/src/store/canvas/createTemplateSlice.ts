/**
 * Template Slice — loadTemplatePack, applySmartResize, resetCanvas
 */

import type { StateCreator } from "zustand";
import type { CanvasStore, Layer } from "./types";
import { DEFAULT_RESIZE, DEFAULT_ARTBOARD_PROPS } from "./types";
import { v4 as uuid } from "uuid";

export type TemplateSlice = Pick<CanvasStore,
    | "loadTemplatePack" | "applySmartResize" | "resetCanvas"
>;

export const createTemplateSlice: StateCreator<CanvasStore, [], [], TemplateSlice> = (set, get) => ({
    resetCanvas: () => {
        set({
            layers: [],
            masterComponents: [],
            componentInstances: [],
            selectedLayerIds: [],
            activeTool: "select",
            zoom: 0.5,
            stageX: 0,
            stageY: 0,
            resizes: [DEFAULT_RESIZE],
            activeResizeId: "master",
            isEditingText: false,
            editingLayerId: null,
            artboardProps: { ...DEFAULT_ARTBOARD_PROPS },
            highlightedFrameId: null,
        });
    },

    loadTemplatePack: (data) => {
        const { masterComponents, componentInstances, resizes, layers: hydratedLayers, baseWidth, baseHeight } = data;

        let finalResizes = [...resizes];
        let masterResize = finalResizes.find(r => r.id === "master");

        if (!masterResize) {
            masterResize = {
                id: "master",
                name: "Мастер макет",
                label: `${baseWidth} × ${baseHeight}`,
                width: baseWidth,
                height: baseHeight,
                instancesEnabled: false
            };
            finalResizes.unshift(masterResize);
        }

        const width = masterResize.width;
        const height = masterResize.height;

        let initialLayers: Layer[];

        if (hydratedLayers && hydratedLayers.length > 0) {
            initialLayers = hydratedLayers;
        } else {
            initialLayers = masterComponents.map((m) => {
                // Ensure slotId is propagated from both MC-level and props-level
                const slotId = m.slotId || (m.props as any).slotId;
                return {
                    ...m.props,
                    id: uuid(),
                    name: m.name,
                    masterId: m.id,
                    type: m.type,
                    ...(slotId ? { slotId } : {}),
                } as Layer;
            });
        }

        set({
            layers: initialLayers,
            masterComponents,
            componentInstances,
            resizes: finalResizes,
            activeResizeId: "master",
            selectedLayerIds: [],
            history: [],
            historyIndex: -1,
            canvasWidth: width,
            canvasHeight: height,
            zoom: 0.5,
            stageX: 0,
            stageY: 0,
        });

        get().syncLayersToResize();
    },

    applySmartResize: (templatePack, mappings) => {
        const { generateSmartResizes } = require("@/services/smartResizeService") as typeof import("@/services/smartResizeService");
        const state = get();
        const result = generateSmartResizes(state.masterComponents, templatePack, mappings);

        const existingResizeIds = new Set(state.resizes.map(r => r.id));
        const newResizes = result.resizes.filter(r => !existingResizeIds.has(r.id));
        const mergedResizes = [...state.resizes, ...newResizes];
        const mergedInstances = [...state.componentInstances, ...result.instances];
        const firstNewResize = newResizes[0];

        set({
            resizes: mergedResizes,
            componentInstances: mergedInstances,
            activeResizeId: firstNewResize?.id || state.activeResizeId,
            canvasWidth: firstNewResize?.width || state.canvasWidth,
            canvasHeight: firstNewResize?.height || state.canvasHeight,
        });

        if (firstNewResize) {
            get().syncLayersToResize();
        }

        return { unmappedSlotNames: result.unmappedSlotNames };
    },
});
