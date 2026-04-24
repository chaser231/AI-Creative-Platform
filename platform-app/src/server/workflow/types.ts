/**
 * Workflow Graph Types — server-side definitions.
 *
 * Phase 1 is the server platform for the node-based workflow editor.
 * Client-side UI types and NODE_REGISTRY consumption arrive in later phases.
 *
 * NODE_REGISTRY here is the single source of truth for node metadata
 * (inputs/outputs, execution target) so server-side dispatch can validate
 * requests and later phases can import the same constant for the UI.
 */

export type WorkflowNodeType =
    | "imageInput"
    | "removeBackground"
    | "addReflection"
    | "mask"
    | "blur"
    | "preview"
    | "assetOutput";

export type PortType = "image" | "mask" | "text" | "number" | "any";

export interface Port {
    id: string;
    type: PortType;
    label: string;
    required?: boolean;
}

export interface WorkflowNode<TType extends WorkflowNodeType = WorkflowNodeType> {
    id: string;
    type: TType;
    position: { x: number; y: number };
    data: {
        params: Record<string, unknown>;
    };
}

export interface WorkflowEdge {
    id: string;
    /** Source node id */
    source: string;
    /** Port id on the source node */
    sourceHandle: string;
    /** Target node id */
    target: string;
    /** Port id on the target node */
    targetHandle: string;
}

export interface WorkflowGraph {
    version: 1;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
}

export type NodeExecutor =
    | { kind: "client"; handler: "imageInput" | "assetOutput" | "preview" }
    | {
          kind: "server";
          actionId:
              | "remove_background"
              | "add_reflection"
              | "apply_mask"
              | "apply_blur";
      };

export interface NodeDefinition {
    type: WorkflowNodeType;
    displayName: string;
    description: string;
    category: "input" | "ai" | "transform" | "output";
    inputs: Port[];
    outputs: Port[];
    defaultParams: Record<string, unknown>;
    execute: NodeExecutor;
}

export const NODE_REGISTRY: Record<WorkflowNodeType, NodeDefinition> = {
    imageInput: {
        type: "imageInput",
        displayName: "Изображение",
        description: "Источник: ассет из библиотеки, URL или загрузка файла.",
        category: "input",
        inputs: [],
        outputs: [{ id: "image-out", type: "image", label: "Изображение" }],
        defaultParams: { source: "asset" },
        execute: { kind: "client", handler: "imageInput" },
    },
    removeBackground: {
        type: "removeBackground",
        displayName: "Удалить фон",
        description: "AI-модель удаляет фон, оставляя альфа-канал. Birefnet сохраняет тени и отражения.",
        category: "ai",
        inputs: [{ id: "image-in", type: "image", label: "Изображение", required: true }],
        outputs: [{ id: "image-out", type: "image", label: "Без фона (RGBA)" }],
        defaultParams: { model: "fal-birefnet" },
        execute: { kind: "server", actionId: "remove_background" },
    },
    addReflection: {
        type: "addReflection",
        displayName: "Добавить отражение",
        description: "AI-генерация чёткого зеркального отражения под продуктом без эффектов.",
        category: "ai",
        inputs: [{ id: "image-in", type: "image", label: "Изображение", required: true }],
        outputs: [{ id: "image-out", type: "image", label: "С отражением" }],
        defaultParams: {
            model: "nano-banana-2",
            prompt: "Выдели продукт из фото, размести его на изолированном однотонном фоне, создай от него идеально ровно неискаженное физически корректное отражение, как будто он стоит на зеркале.",
        },
        execute: { kind: "server", actionId: "add_reflection" },
    },
    mask: {
        type: "mask",
        displayName: "Маска (градиент)",
        description: "Линейный градиент альфа-канала с двумя точками контроля. Применяется поверх RGBA.",
        category: "transform",
        inputs: [{ id: "image-in", type: "image", label: "Изображение (RGBA)", required: true }],
        outputs: [{ id: "image-out", type: "image", label: "Изображение (RGBA)" }],
        defaultParams: { direction: "top-to-bottom", start: 1, end: 0 },
        execute: { kind: "server", actionId: "apply_mask" },
    },
    blur: {
        type: "blur",
        displayName: "Блюр",
        description: "Uniform или progressive блюр (как в Figma) с настраиваемым направлением.",
        category: "transform",
        inputs: [{ id: "image-in", type: "image", label: "Изображение", required: true }],
        outputs: [{ id: "image-out", type: "image", label: "Изображение" }],
        defaultParams: { mode: "progressive", intensity: 4, direction: "bottom-to-top", start: 0, end: 12 },
        execute: { kind: "server", actionId: "apply_blur" },
    },
    preview: {
        type: "preview",
        displayName: "Превью",
        description: "Отображает изображение без сохранения в ассеты.",
        category: "output",
        inputs: [{ id: "image-in", type: "image", label: "Изображение", required: true }],
        outputs: [{ id: "image-out", type: "image", label: "Изображение" }],
        defaultParams: {},
        execute: { kind: "client", handler: "preview" },
    },
    assetOutput: {
        type: "assetOutput",
        displayName: "Сохранить в библиотеку",
        description: "Записывает итоговое изображение как Asset воркспейса.",
        category: "output",
        inputs: [{ id: "image-in", type: "image", label: "Изображение", required: true }],
        outputs: [],
        defaultParams: { name: "Workflow output" },
        execute: { kind: "client", handler: "assetOutput" },
    },
};

/** Action ids that the /api/workflow/execute-node endpoint accepts. */
export type ServerActionId =
    | "remove_background"
    | "add_reflection"
    | "apply_mask"
    | "apply_blur";

/** Request body for POST /api/workflow/execute-node (D-04: client-resolved inputs). */
export interface ExecuteNodeRequest {
    actionId: ServerActionId;
    params: Record<string, unknown>;
    inputs: Record<string, { imageUrl: string }>;
    workspaceId: string;
    /** Reserved for future cost-tracking per-run; ignored in Phase 1 (D-02). */
    workflowId?: string;
}

export interface ExecuteNodeSuccess {
    success: true;
    type: "image";
    imageUrl: string;
    metadata?: {
        provider?: string;
        costUsd?: number;
    };
    requestId: string;
}

export type ExecuteNodeErrorCode =
    | "UNAUTHORIZED"
    | "SSRF_BLOCKED"
    | "RATE_LIMITED"
    | "PROVIDER_FAILED"
    | "BAD_REQUEST";

export interface ExecuteNodeError {
    success: false;
    type: "error";
    error: string;
    code: ExecuteNodeErrorCode;
    requestId: string;
    /** Seconds until rate-limit resets (present when code === "RATE_LIMITED"). */
    retryAfter?: number;
}

export type ExecuteNodeResponse = ExecuteNodeSuccess | ExecuteNodeError;
