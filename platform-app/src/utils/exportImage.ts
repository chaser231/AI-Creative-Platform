import JSZip from "jszip";
import { saveAs } from "file-saver";

export function sanitizeExportFileName(value: string): string {
    const normalized = value
        .trim()
        .replace(/[\\/:"*?<>|]+/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return normalized || "export";
}

export function downloadDataUrl(dataUrl: string, fileName: string): void {
    const link = document.createElement("a");
    link.download = fileName;
    link.href = dataUrl;
    link.click();
}

export async function zipPngDataUrls(
    entries: Array<{ fileName: string; dataUrl: string }>,
    zipName: string,
): Promise<void> {
    const zip = new JSZip();
    for (const entry of entries) {
        const base64Data = entry.dataUrl.replace(/^data:image\/png;base64,/, "");
        zip.file(entry.fileName, base64Data, { base64: true });
    }
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, zipName);
}

export async function zipTextFiles(
    entries: Array<{ fileName: string; content: string }>,
    zipName: string,
): Promise<void> {
    const zip = new JSZip();
    for (const entry of entries) {
        zip.file(entry.fileName, entry.content);
    }
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, zipName);
}
