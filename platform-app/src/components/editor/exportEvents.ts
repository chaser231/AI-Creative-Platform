/**
 * Decoupled "open the export modal" request. The editor page owns the modal
 * state; deep components (e.g. the slice inspector in the properties panel)
 * fire this event instead of threading a callback through every layer.
 */

export const OPEN_EXPORT_MODAL_EVENT = "acp:open-export-modal";

export interface OpenExportModalDetail {
    /** Optional export target to preselect (frame or slice layer id). */
    targetId?: string;
}

export function requestOpenExportModal(targetId?: string) {
    window.dispatchEvent(new CustomEvent<OpenExportModalDetail>(OPEN_EXPORT_MODAL_EVENT, {
        detail: { targetId },
    }));
}
