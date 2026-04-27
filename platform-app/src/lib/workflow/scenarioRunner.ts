import {
    NODE_REGISTRY,
    type WorkflowEdge,
    type WorkflowGraph,
    type WorkflowNode,
} from "@/server/workflow/types";
import type {
    WorkflowScenarioConfig,
    WorkflowScenarioInputKind,
    WorkflowScenarioOutputKind,
} from "./scenarioConfig";

export interface ScenarioRunInput {
    kind?: WorkflowScenarioInputKind;
    imageUrl?: string;
    assetId?: string;
    text?: string;
    selectedLayerId?: string;
}

export interface ScenarioNodeResult {
    url?: string;
    text?: string;
    assetId?: string;
}

export interface ScenarioExecutionGraph {
    graph: WorkflowGraph;
    externalInputResults: Record<string, ScenarioNodeResult>;
    externalInputEdges: WorkflowEdge[];
}

export interface PickedScenarioResult {
    nodeId: string;
    outputKind: WorkflowScenarioOutputKind;
    result: ScenarioNodeResult;
}

const EXTERNAL_INPUT_NODE_ID = "__scenario_external_input__";

export function buildScenarioExecutionGraph(
    graph: WorkflowGraph,
    scenarioConfig: WorkflowScenarioConfig,
    input: ScenarioRunInput = {},
): ScenarioExecutionGraph {
    const kind = input.kind ?? scenarioConfig.input.kind;

    if (!hasScenarioInput(kind, input)) {
        if (scenarioConfig.input.required) {
            throw new Error(missingInputMessage(kind, input));
        }
        return emptyScenarioExecutionGraph(graph);
    }

    if (kind === "text") {
        return injectTextContext(graph, input);
    }

    if (kind === "layer" && !input.imageUrl && !input.assetId) {
        throw new Error("Пока поддерживаются только image-слои как вход сценария");
    }

    return injectImageContext(graph, input);
}

export function pickScenarioResult(
    graph: WorkflowGraph,
    results: Record<string, ScenarioNodeResult>,
    scenarioConfig: WorkflowScenarioConfig,
): PickedScenarioResult | null {
    const outputKind = scenarioConfig.output.kind;

    if (outputKind === "text") {
        return pickTextResult(graph, results, outputKind);
    }

    if (outputKind === "banner") {
        return (
            pickImageResult(graph, results, outputKind) ??
            pickTextResult(graph, results, outputKind)
        );
    }

    return pickImageResult(graph, results, outputKind);
}

export function scenarioMissingOutputMessage(
    scenarioConfig: WorkflowScenarioConfig,
): string {
    switch (scenarioConfig.output.kind) {
        case "text":
            return "Сценарий не вернул текст";
        case "asset":
            return "Сценарий не вернул изображение для сохранения";
        case "banner":
            return "Сценарий не вернул результат для баннера";
        case "image":
        default:
            return "Сценарий не вернул изображение";
    }
}

function emptyScenarioExecutionGraph(graph: WorkflowGraph): ScenarioExecutionGraph {
    return {
        graph,
        externalInputResults: {},
        externalInputEdges: [],
    };
}

function hasScenarioInput(kind: WorkflowScenarioInputKind, input: ScenarioRunInput): boolean {
    if (kind === "text") return Boolean(input.text?.trim());
    if (kind === "layer") return Boolean(input.selectedLayerId || input.imageUrl || input.assetId);
    return Boolean(input.imageUrl || input.assetId);
}

function missingInputMessage(
    kind: WorkflowScenarioInputKind,
    input: ScenarioRunInput,
): string {
    if (kind === "text") return "Введите текст для запуска сценария";
    if (kind === "layer") {
        return input.selectedLayerId
            ? "Пока поддерживаются только image-слои как вход сценария"
            : "Выберите слой для запуска сценария";
    }
    return "Выберите изображение для запуска сценария";
}

function injectImageContext(
    graph: WorkflowGraph,
    input: ScenarioRunInput,
): ScenarioExecutionGraph {
    const imageInput = graph.nodes.find((node) => node.type === "imageInput");
    if (imageInput) {
        return {
            graph: {
                ...graph,
                nodes: graph.nodes.map((node): WorkflowNode => {
                    if (node.id !== imageInput.id) return node;
                    return {
                        ...node,
                        data: {
                            params: input.assetId
                                ? {
                                      ...node.data.params,
                                      source: "asset",
                                      assetId: input.assetId,
                                      sourceUrl: input.imageUrl,
                                  }
                                : {
                                      ...node.data.params,
                                      source: "url",
                                      sourceUrl: input.imageUrl,
                                      assetId: undefined,
                                  },
                        },
                    };
                }),
            },
            externalInputResults: {},
            externalInputEdges: [],
        };
    }

    const target = findExternalInputTarget(graph, "image");
    if (!target) {
        throw new Error("В сценарии нет входа для изображения");
    }

    return {
        graph,
        externalInputResults: {
            [EXTERNAL_INPUT_NODE_ID]: {
                url: input.imageUrl,
                assetId: input.assetId,
            },
        },
        externalInputEdges: [
            makeExternalEdge("image-out", target.node.id, target.portId),
        ],
    };
}

function injectTextContext(
    graph: WorkflowGraph,
    input: ScenarioRunInput,
): ScenarioExecutionGraph {
    const text = input.text?.trim();
    if (!text) {
        throw new Error("Введите текст для запуска сценария");
    }

    const target = findExternalInputTarget(graph, "text");
    if (!target) {
        throw new Error("В сценарии нет входа для текста");
    }

    return {
        graph,
        externalInputResults: {
            [EXTERNAL_INPUT_NODE_ID]: { text },
        },
        externalInputEdges: [
            makeExternalEdge("text-out", target.node.id, target.portId),
        ],
    };
}

function makeExternalEdge(
    sourceHandle: string,
    target: string,
    targetHandle: string,
): WorkflowEdge {
    return {
        id: `${EXTERNAL_INPUT_NODE_ID}->${target}:${targetHandle}`,
        source: EXTERNAL_INPUT_NODE_ID,
        sourceHandle,
        target,
        targetHandle,
    };
}

function findExternalInputTarget(
    graph: WorkflowGraph,
    kind: "image" | "text",
): { node: WorkflowNode; portId: string } | null {
    const preferred = findInputTarget(graph, kind, (portId) => portId === "context-in");
    if (preferred) return preferred;
    return findInputTarget(graph, kind);
}

function findInputTarget(
    graph: WorkflowGraph,
    kind: "image" | "text",
    predicate: (portId: string) => boolean = () => true,
): { node: WorkflowNode; portId: string } | null {
    for (const node of graph.nodes) {
        const definition = NODE_REGISTRY[node.type];
        for (const port of definition.inputs) {
            if (!predicate(port.id)) continue;
            if (port.type === "any" || port.type === kind) {
                return { node, portId: port.id };
            }
        }
    }
    return null;
}

function pickImageResult(
    graph: WorkflowGraph,
    results: Record<string, ScenarioNodeResult>,
    outputKind: WorkflowScenarioOutputKind,
): PickedScenarioResult | null {
    return pickFromGroups(
        graph,
        results,
        outputKind,
        [
            graph.nodes.filter((node) => node.type === "assetOutput"),
            graph.nodes.filter((node) => node.type === "preview"),
            leafNodes(graph),
            graph.nodes,
        ],
        (result) => typeof result.url === "string" && result.url.length > 0,
    );
}

function pickTextResult(
    graph: WorkflowGraph,
    results: Record<string, ScenarioNodeResult>,
    outputKind: WorkflowScenarioOutputKind,
): PickedScenarioResult | null {
    return pickFromGroups(
        graph,
        results,
        outputKind,
        [leafNodes(graph), graph.nodes],
        (result) => typeof result.text === "string" && result.text.length > 0,
    );
}

function pickFromGroups(
    graph: WorkflowGraph,
    results: Record<string, ScenarioNodeResult>,
    outputKind: WorkflowScenarioOutputKind,
    groups: WorkflowNode[][],
    predicate: (result: ScenarioNodeResult) => boolean,
): PickedScenarioResult | null {
    const knownNodeIds = new Set(graph.nodes.map((node) => node.id));
    const seen = new Set<string>();

    for (const group of groups) {
        for (const node of [...group].reverse()) {
            if (!knownNodeIds.has(node.id) || seen.has(node.id)) continue;
            seen.add(node.id);
            const result = results[node.id];
            if (result && predicate(result)) {
                return { nodeId: node.id, outputKind, result };
            }
        }
    }

    return null;
}

function leafNodes(graph: WorkflowGraph): WorkflowNode[] {
    return graph.nodes.filter(
        (node) => !graph.edges.some((edge) => edge.source === node.id),
    );
}
