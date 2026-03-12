export function isFocusedOnInput(e: Event | React.UIEvent): boolean {
    const target = e.target as HTMLElement | null;
    if (!target) return false;

    // Standard form inputs
    if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
    ) {
        return true;
    }

    // Content editable elements
    if (target.isContentEditable) {
        return true;
    }

    return false;
}
