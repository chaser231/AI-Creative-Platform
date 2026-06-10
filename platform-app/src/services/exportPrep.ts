import type Konva from "konva";

/** Wait for web fonts and two paint frames so Konva text matches the store. */
export async function prepareStageForExport(stage: Konva.Stage | null): Promise<void> {
    if (typeof document !== "undefined" && document.fonts?.ready) {
        try {
            await document.fonts.ready;
        } catch {
            // proceed with best-effort layout
        }
    }
    if (!stage) return;
    stage.batchDraw();
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}
