/**
 * Parse a Figma file URL into a {fileKey, nodeId} tuple.
 *
 * Accepts the usual shapes:
 *   https://www.figma.com/file/KEY/title
 *   https://www.figma.com/design/KEY/title
 *   https://www.figma.com/proto/KEY/title
 *   https://figma.com/file/KEY
 *   …plus an optional ?node-id=1%3A2 query, which we decode to "1:2".
 *
 * Also accepts a bare file key ("aBc123…") so callers don't have to care which
 * shape the user pasted.
 */

export interface ParsedFigmaUrl {
    fileKey: string;
    nodeId?: string;
}

const FIGMA_HOST_RE = /(?:^|\.)figma\.com$/i;
const FILE_PATH_RE = /^\/(?:file|design|proto)\/([A-Za-z0-9]+)(?:\/|$)/;
const BARE_KEY_RE = /^[A-Za-z0-9]{10,64}$/;

export function parseFigmaUrl(input: string): ParsedFigmaUrl | null {
    if (!input) return null;
    const trimmed = input.trim();
    if (!trimmed) return null;

    if (BARE_KEY_RE.test(trimmed)) {
        return { fileKey: trimmed };
    }

    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return null;
    }

    if (!FIGMA_HOST_RE.test(url.hostname)) return null;

    const m = url.pathname.match(FILE_PATH_RE);
    if (!m) return null;

    const fileKey = m[1];
    const rawNodeId = url.searchParams.get("node-id") ?? undefined;
    // Figma uses "1-2" in fresh share URLs and "1%3A2" (=> "1:2") in legacy ones.
    const nodeId = rawNodeId
        ? rawNodeId.includes(":")
            ? rawNodeId
            : rawNodeId.replace(/-/g, ":")
        : undefined;

    return nodeId ? { fileKey, nodeId } : { fileKey };
}
