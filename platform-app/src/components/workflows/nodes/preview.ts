import type { WorkflowNodeType } from "@/server/workflow/types";
import type { NodeResult } from "@/store/workflow/types";

export type WorkflowNodePreviewSource = "input" | "result";

export interface WorkflowNodePreview {
    url?: string;
    text?: string;
    source: WorkflowNodePreviewSource;
}

export function getWorkflowNodePreview(
    type: WorkflowNodeType,
    params: Record<string, unknown> | undefined,
    result: NodeResult | undefined,
): WorkflowNodePreview | null {
    const sourceUrl = params?.sourceUrl;
    if (type === "imageInput" && typeof sourceUrl === "string" && sourceUrl.length > 0) {
        return { url: sourceUrl, source: "input" };
    }

    if (typeof result?.url === "string" && result.url.length > 0) {
        return { url: result.url, source: "result" };
    }

    if (typeof result?.text === "string" && result.text.length > 0) {
        return { text: result.text, source: "result" };
    }

    return null;
}
