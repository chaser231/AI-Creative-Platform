/**
 * Batch result export for "Мульти-генерация".
 *
 * Bundles every generated result of a batch into a single ZIP downloaded in
 * the browser. File names are derived from the source image name with a
 * numeric prefix so the archive stays ordered and collision-free. The naming
 * helpers are pure and unit tested; the fetch + zip path runs only in the
 * browser.
 */

import JSZip from "jszip";
import { saveAs } from "file-saver";
import { sanitizeExportFileName } from "@/utils/exportImage";

const KNOWN_EXTENSIONS = new Set([
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "bmp",
    "avif",
    "tiff",
]);

/** Extract a sane file extension from a URL, defaulting to jpg. */
export function extFromUrl(url: string): string {
    try {
        const { pathname } = new URL(url);
        const dot = pathname.lastIndexOf(".");
        if (dot >= 0) {
            const ext = pathname.slice(dot + 1).toLowerCase();
            if (KNOWN_EXTENSIONS.has(ext)) return ext === "jpeg" ? "jpg" : ext;
        }
    } catch {
        // fall through
    }
    return "jpg";
}

function stripExtension(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Build a unique, sorted file name for one result image.
 * Format: `003-product-name.jpg` (or `003-product-name-2.jpg` when an input
 * produced multiple results).
 */
export function buildResultFileName(args: {
    sourceName: string | null;
    itemIndex: number;
    resultIndex: number;
    resultsForItem: number;
    url: string;
}): string {
    const { sourceName, itemIndex, resultIndex, resultsForItem, url } = args;
    const base = sourceName
        ? sanitizeExportFileName(stripExtension(sourceName))
        : `image-${itemIndex + 1}`;
    const prefix = String(itemIndex + 1).padStart(3, "0");
    const suffix = resultsForItem > 1 ? `-${resultIndex + 1}` : "";
    return `${prefix}-${base}${suffix}.${extFromUrl(url)}`;
}

export interface BatchExportItem {
    sourceName: string | null;
    index: number;
    resultUrls: string[];
}

export interface BatchExportResult {
    added: number;
    failed: number;
}

interface FetchLike {
    (url: string): Promise<{ ok: boolean; blob: () => Promise<Blob> }>;
}

/**
 * Fetch every result image and stream them into a ZIP download. Failed
 * fetches are counted and skipped so one dead URL never aborts the export.
 * `fetchImpl` is injectable for testing; defaults to the global fetch.
 */
export async function exportBatchResultsZip(
    items: BatchExportItem[],
    zipName: string,
    opts?: { fetchImpl?: FetchLike },
): Promise<BatchExportResult> {
    const fetchImpl: FetchLike =
        opts?.fetchImpl ?? ((url: string) => fetch(url));
    const zip = new JSZip();
    const usedNames = new Set<string>();

    let added = 0;
    let failed = 0;

    const ordered = [...items].sort((a, b) => a.index - b.index);

    for (let i = 0; i < ordered.length; i++) {
        const item = ordered[i];
        for (let r = 0; r < item.resultUrls.length; r++) {
            const url = item.resultUrls[r];
            try {
                const res = await fetchImpl(url);
                if (!res.ok) {
                    failed += 1;
                    continue;
                }
                // Add as ArrayBuffer — JSZip accepts it in both the browser
                // and Node (its Blob support is browser-only).
                const buffer = await (await res.blob()).arrayBuffer();
                let name = buildResultFileName({
                    sourceName: item.sourceName,
                    itemIndex: i,
                    resultIndex: r,
                    resultsForItem: item.resultUrls.length,
                    url,
                });
                // Defensive de-dup in case two inputs share a name.
                if (usedNames.has(name)) {
                    const dot = name.lastIndexOf(".");
                    name = `${name.slice(0, dot)}-${added}${name.slice(dot)}`;
                }
                usedNames.add(name);
                zip.file(name, buffer);
                added += 1;
            } catch {
                failed += 1;
            }
        }
    }

    if (added > 0) {
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, zipName);
    }

    return { added, failed };
}
