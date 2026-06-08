/**
 * Human-readable names for numeric font weights, so the weight picker shows
 * "Bold" instead of "700". Non-standard weights fall back to their number.
 */
const WEIGHT_NAMES: Record<string, string> = {
    "100": "Thin",
    "200": "Extra Light",
    "300": "Light",
    "400": "Regular",
    "500": "Medium",
    "600": "Semi Bold",
    "700": "Bold",
    "800": "Extra Bold",
    "900": "Black",
};

export function weightLabel(weight: string | number | undefined | null): string {
    if (weight === undefined || weight === null || weight === "") return "Regular";
    const raw = String(weight).trim().toLowerCase();
    if (raw === "normal") return WEIGHT_NAMES["400"];
    if (raw === "bold") return WEIGHT_NAMES["700"];
    return WEIGHT_NAMES[raw] ?? String(weight);
}
