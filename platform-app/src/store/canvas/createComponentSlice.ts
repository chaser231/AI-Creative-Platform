/**
 * Component Slice — Master/Instance cascading
 */

import type { StateCreator } from "zustand";
import type { CanvasStore, ComponentProps, Layer, MasterComponent, ComponentInstance } from "./types";
import { CONTENT_SOURCE_KEYS } from "@/types";
import { v4 as uuid } from "uuid";

export type ComponentSlice = Pick<CanvasStore,
    | "masterComponents" | "componentInstances"
    | "promoteToMaster" | "updateMasterComponent"
>;

export const createComponentSlice: StateCreator<CanvasStore, [], [], ComponentSlice> = (set, get) => ({
    masterComponents: [],
    componentInstances: [],

    promoteToMaster: (layerId) => {
        const state = get();
        const layer = state.layers.find((l) => l.id === layerId);
        if (!layer || layer.masterId) return;

        const masterId = uuid();
        const { id: _id, name, type, masterId: _mid, ...rest } = layer;
        void _id; void _mid;
        const master: MasterComponent = {
            id: masterId,
            type,
            name,
            props: rest as ComponentProps,
        };
        const newInstances: ComponentInstance[] = state.resizes
            .filter((r) => r.id !== "master")
            .map((r) => ({
                id: uuid(),
                masterId,
                resizeId: r.id,
                localProps: { ...rest } as ComponentProps,
            }));
        set((s) => ({
            layers: s.layers.map((l) =>
                l.id === layerId ? { ...l, masterId } as Layer : l
            ),
            masterComponents: [...s.masterComponents, master],
            componentInstances: [...s.componentInstances, ...newInstances],
        }));
    },

    updateMasterComponent: (masterId, updates) => {
        set((state) => {
            const master = state.masterComponents.find((m) => m.id === masterId);
            if (!master) return {};

            const newMasters = state.masterComponents.map((m) =>
                m.id === masterId
                    ? { ...m, props: { ...m.props, ...updates } as ComponentProps }
                    : m
            );

            const contentKeys = CONTENT_SOURCE_KEYS[master.type] || [];
            const contentUpdates: Record<string, unknown> = {};
            let hasContentChange = false;
            for (const key of contentKeys) {
                if (key in updates) {
                    contentUpdates[key] = (updates as Record<string, unknown>)[key];
                    hasContentChange = true;
                }
            }

            let newInstances = state.componentInstances;
            if (hasContentChange) {
                newInstances = state.componentInstances.map((inst) => {
                    if (inst.masterId !== masterId) return inst;
                    const resize = state.resizes.find((r) => r.id === inst.resizeId);
                    if (!resize?.instancesEnabled) return inst;

                    const localContentUpdates = { ...contentUpdates };
                    if (inst.localProps.detachedSizeSync) {
                        delete localContentUpdates.width;
                        delete localContentUpdates.height;
                    }

                    return {
                        ...inst,
                        localProps: { ...inst.localProps, ...localContentUpdates } as ComponentProps,
                    };
                });
            }

            const newLayers = state.activeResizeId === "master"
                ? state.layers.map((l) => {
                    if (l.masterId === masterId) {
                        return { ...l, ...updates } as Layer;
                    }
                    return l;
                })
                : state.layers;

            return {
                masterComponents: newMasters,
                componentInstances: newInstances,
                layers: newLayers,
            };
        });
    },
});
