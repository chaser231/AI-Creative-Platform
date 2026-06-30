/** Max resolved variants kept per layer in studio/wizard generation strips. */
export const MAX_VARIANTS_PER_LAYER = 12;

/** Keep only the most recent variants to bound DOM nodes and memory. */
export function capLayerVariants<T>(variants: T[], max = MAX_VARIANTS_PER_LAYER): T[] {
    if (variants.length <= max) return variants;
    return variants.slice(-max);
}
