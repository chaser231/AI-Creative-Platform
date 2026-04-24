import { emptyWorkflowGraph } from "./graphSchema";
import type {
    WorkflowEdge,
    WorkflowGraph,
    WorkflowNode,
    WorkflowNodeType,
} from "@/server/workflow/types";
import { NODE_REGISTRY } from "@/server/workflow/types";

export const WORKFLOW_PRESET_IDS = [
    "product-reflection-pipeline",
    "remove-background-preview",
    "asset-transform-save",
] as const;

export type WorkflowPresetId = (typeof WORKFLOW_PRESET_IDS)[number];

export interface WorkflowPresetDraft {
    id: WorkflowPresetId;
    name: string;
    description: string;
    graph: WorkflowGraph;
}

interface NodeSpec {
    id: string;
    type: WorkflowNodeType;
    x: number;
    y: number;
    params?: Record<string, unknown>;
}

interface EdgeSpec {
    source: string;
    target: string;
}

const WORKFLOW_PRESET_META: Record<
    WorkflowPresetId,
    { name: string; description: string }
> = {
    "product-reflection-pipeline": {
        name: "Продукт с отражением",
        description:
            "Добавляет реалистичное отражение, очищает фон и готовит мягкое превью продукта.",
    },
    "remove-background-preview": {
        name: "Удалить фон + превью",
        description: "Быстрый сценарий: источник, удаление фона и визуальная проверка результата.",
    },
    "asset-transform-save": {
        name: "Трансформировать и сохранить",
        description:
            "Берёт ассет, применяет базовую AI-трансформацию и сохраняет результат в библиотеку.",
    },
};

const WORKFLOW_PRESET_BUILDERS: Record<WorkflowPresetId, () => WorkflowGraph> = {
    "product-reflection-pipeline": () =>
        createGraph(
            [
                { id: "input", type: "imageInput", x: 0, y: 0 },
                { id: "reflection", type: "addReflection", x: 300, y: 0 },
                { id: "cutout", type: "removeBackground", x: 600, y: 0 },
                { id: "fade", type: "mask", x: 900, y: 0 },
                {
                    id: "soften",
                    type: "blur",
                    x: 1200,
                    y: 0,
                    params: {
                        mode: "progressive",
                        direction: "bottom-to-top",
                        startPos: 0,
                        endPos: 0.42,
                        startIntensity: 10,
                        endIntensity: 0,
                        intensity: 4,
                    },
                },
                { id: "preview", type: "preview", x: 1500, y: 0 },
            ],
            [
                { source: "input", target: "reflection" },
                { source: "reflection", target: "cutout" },
                { source: "cutout", target: "fade" },
                { source: "fade", target: "soften" },
                { source: "soften", target: "preview" },
            ],
        ),
    "remove-background-preview": () =>
        createGraph(
            [
                { id: "input", type: "imageInput", x: 0, y: 0 },
                { id: "cutout", type: "removeBackground", x: 300, y: 0 },
                { id: "preview", type: "preview", x: 600, y: 0 },
            ],
            [
                { source: "input", target: "cutout" },
                { source: "cutout", target: "preview" },
            ],
        ),
    "asset-transform-save": () =>
        createGraph(
            [
                { id: "input", type: "imageInput", x: 0, y: 0 },
                { id: "cutout", type: "removeBackground", x: 300, y: 0 },
                {
                    id: "output",
                    type: "assetOutput",
                    x: 600,
                    y: 0,
                    params: { name: "Workflow output" },
                },
            ],
            [
                { source: "input", target: "cutout" },
                { source: "cutout", target: "output" },
            ],
        ),
};

export function createWorkflowPresetDraft(
    presetId: string | null | undefined,
): WorkflowPresetDraft | null {
    if (!isWorkflowPresetId(presetId)) return null;
    const meta = WORKFLOW_PRESET_META[presetId];
    return {
        id: presetId,
        name: meta.name,
        description: meta.description,
        graph: WORKFLOW_PRESET_BUILDERS[presetId](),
    };
}

export function createWorkflowGraphForPreset(
    presetId: string | null | undefined,
): WorkflowGraph {
    return createWorkflowPresetDraft(presetId)?.graph ?? emptyWorkflowGraph();
}

export function isWorkflowPresetId(
    presetId: string | null | undefined,
): presetId is WorkflowPresetId {
    return WORKFLOW_PRESET_IDS.includes(presetId as WorkflowPresetId);
}

function createGraph(nodes: NodeSpec[], edges: EdgeSpec[]): WorkflowGraph {
    return {
        version: 1,
        nodes: nodes.map(toWorkflowNode),
        edges: edges.map((edge) => toWorkflowEdge(edge)),
    };
}

function toWorkflowNode(spec: NodeSpec): WorkflowNode {
    return {
        id: `preset-${spec.id}`,
        type: spec.type,
        position: { x: spec.x, y: spec.y },
        data: {
            params: {
                ...NODE_REGISTRY[spec.type].defaultParams,
                ...spec.params,
            },
        },
    };
}

function toWorkflowEdge(spec: EdgeSpec): WorkflowEdge {
    const source = `preset-${spec.source}`;
    const target = `preset-${spec.target}`;
    return {
        id: `preset-edge-${spec.source}-${spec.target}`,
        source,
        sourceHandle: "image-out",
        target,
        targetHandle: "image-in",
    };
}
