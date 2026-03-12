import { Layer, FrameLayer, TextLayer } from "@/types";

// ─── Text Size Estimation ──────────────────────────────────────
// Uses an OffscreenCanvas (or in-memory canvas) to measure text
// dimensions the same way Konva would, without needing a live stage.

let _measureCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;

function getMeasureCanvas(): OffscreenCanvas | HTMLCanvasElement {
    if (!_measureCanvas) {
        if (typeof OffscreenCanvas !== "undefined") {
            _measureCanvas = new OffscreenCanvas(1, 1);
        } else if (typeof document !== "undefined") {
            _measureCanvas = document.createElement("canvas");
        } else {
            // SSR fallback — will use rough estimates
            return null as any;
        }
    }
    return _measureCanvas;
}

/**
 * Estimate the rendered size of a text layer.
 * - `auto_width`: single-line, width = measured text width, height = single line height
 * - `auto_height`: width is fixed (from layer.width), height = wrapped line count × line height
 * - `fixed`: uses stored width/height as-is
 */
function estimateTextSize(
    text: TextLayer,
    containerWidth?: number
): { width: number; height: number } {
    const textAdjust = text.textAdjust || "auto_width";

    if (textAdjust === "fixed") {
        return { width: text.width, height: text.height };
    }

    const fontStyle = text.fontWeight === "700" || text.fontWeight === "bold"
        ? "bold"
        : text.fontWeight === "600"
            ? "600"
            : "normal";

    const fontSpec = `${fontStyle} ${text.fontSize}px ${text.fontFamily}`;
    const singleLineHeight = text.fontSize * (text.lineHeight || 1.2);

    const canvas = getMeasureCanvas();
    if (!canvas) {
        // SSR fallback: rough estimate
        const avgCharWidth = text.fontSize * 0.6;
        const totalLetterSpacing = Math.max(0, text.text.length - 1) * (text.letterSpacing || 0);

        if (textAdjust === "auto_width") {
            const w = text.text.length * avgCharWidth + totalLetterSpacing;
            return { width: Math.max(1, w), height: Math.max(1, singleLineHeight) };
        }
        // auto_height
        const fixedW = containerWidth ?? text.width;
        const charsPerLine = Math.max(1, Math.floor(fixedW / (avgCharWidth + (text.letterSpacing || 0))));
        const lineCount = Math.max(1, Math.ceil(text.text.length / charsPerLine));
        return { width: fixedW, height: Math.max(1, lineCount * singleLineHeight) };
    }

    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    if (!ctx) {
        return { width: text.width, height: text.height };
    }
    ctx.font = fontSpec;

    if (textAdjust === "auto_width") {
        // Single line, no wrapping
        const metrics = ctx.measureText(text.text);
        const totalLetterSpacing = Math.max(0, text.text.length - 1) * (text.letterSpacing || 0);
        const measuredWidth = metrics.width + totalLetterSpacing;
        return {
            width: Math.max(1, measuredWidth),
            height: Math.max(1, singleLineHeight),
        };
    }

    // auto_height — wrap text within `containerWidth` (or stored width) and count lines
    const fixedW = containerWidth ?? text.width;
    const lineCount = countWrappedLines(ctx, text.text, fixedW, text.letterSpacing || 0);
    return {
        width: fixedW,
        height: Math.max(1, lineCount * singleLineHeight),
    };
}

/**
 * Count how many visual lines the text occupies when word-wrapped
 * to a given width. Handles letter spacing.
 */
function countWrappedLines(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    letterSpacing: number
): number {
    if (!text || maxWidth <= 0) return 1;

    const paragraphs = text.split("\n");
    let totalLines = 0;

    for (const paragraph of paragraphs) {
        if (paragraph === "") {
            totalLines += 1;
            continue;
        }
        const words = paragraph.split(/\s+/);
        let currentLine = "";
        let lines = 0;

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const testWidth = ctx.measureText(testLine).width +
                Math.max(0, testLine.length - 1) * letterSpacing;

            if (testWidth > maxWidth && currentLine) {
                lines++;
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines++;
        totalLines += Math.max(1, lines);
    }
    return Math.max(1, totalLines);
}

// ─── Core Auto-Layout Engine ───────────────────────────────────

/**
 * Re-computes the x, y, width, and height of layers living inside an auto-layout frame.
 * This function returns a partial record of updates. It does NOT mutate the layers directly.
 *
 * Key improvements over the naive version:
 * 1. Text children with `textAdjust: auto_width | auto_height` are measured via Canvas 2D
 * 2. Children with `layoutSizingWidth/Height: 'hug'` (nested frames) use already-resolved sizes
 * 3. `fill` children inside a `hug` axis are treated as `fixed` for measurement, then expanded
 * 4. All child sizes are clamped to ≥ 1 to prevent degenerate layouts
 */
export function computeAutoLayout(
    frame: FrameLayer,
    allLayers: Layer[]
): Record<string, Partial<Layer>> {
    const updates: Record<string, Partial<Layer>> = {};

    if (!frame.layoutMode || frame.layoutMode === "none") {
        return updates;
    }

    const {
        paddingTop = 0,
        paddingRight = 0,
        paddingBottom = 0,
        paddingLeft = 0,
        spacing = 0,
        layoutMode,
        primaryAxisAlignItems = "flex-start",
        counterAxisAlignItems = "flex-start",
        primaryAxisSizingMode = "fixed",
        counterAxisSizingMode = "fixed",
    } = frame;

    const isHorizontal = layoutMode === "horizontal";

    // Is this axis in "hug" mode?
    const primaryHug = primaryAxisSizingMode === "auto";
    const counterHug = counterAxisSizingMode === "auto";

    // Filter and map children
    const childLayers = frame.childIds
        .map(id => allLayers.find(l => l.id === id))
        .filter((l): l is Layer => !!l && !l.isAbsolutePositioned && l.visible);

    if (childLayers.length === 0) {
        // Just resize the frame itself if it's "hug"
        if (primaryHug || counterHug) {
            const w = (isHorizontal && primaryHug) || (!isHorizontal && counterHug)
                ? paddingLeft + paddingRight
                : frame.width;
            const h = (!isHorizontal && primaryHug) || (isHorizontal && counterHug)
                ? paddingTop + paddingBottom
                : frame.height;
            updates[frame.id] = { width: w, height: h };
        }
        return updates;
    }

    // ── First pass: resolve intrinsic child sizes ──────────────

    interface MeasuredChild {
        id: string;
        intrinsicW: number;
        intrinsicH: number;
        fillPrimary: boolean;
        fillCounter: boolean;
    }

    const measured: MeasuredChild[] = childLayers.map(child => {
        let w = child.width;
        let h = child.height;

        // --- Text auto-sizing ---
        if (child.type === "text") {
            const textChild = child as TextLayer;
            const adj = textChild.textAdjust || "auto_width";

            if (adj === "auto_width") {
                const est = estimateTextSize(textChild);
                w = est.width;
                h = est.height;
                // Sync back to store
                updates[child.id] = { ...updates[child.id], width: w, height: h };
            } else if (adj === "auto_height") {
                // Width stays fixed (or fill — handled below), height is measured
                const est = estimateTextSize(textChild, child.width);
                h = est.height;
                updates[child.id] = { ...updates[child.id], height: h };
            }
        }

        // Determine fill flags
        const fillPrimary = isHorizontal
            ? child.layoutSizingWidth === "fill"
            : child.layoutSizingHeight === "fill";

        const fillCounter = isHorizontal
            ? child.layoutSizingHeight === "fill"
            : child.layoutSizingWidth === "fill";

        // Clamp to minimum
        w = Math.max(1, w);
        h = Math.max(1, h);

        return { id: child.id, intrinsicW: w, intrinsicH: h, fillPrimary, fillCounter };
    });

    // ── Accumulate totals for hug sizing ───────────────────────
    // When computing hug size, fill children on that axis contribute 0
    // (they expand to match the frame, not the other way around)

    let totalPrimaryNonFill = 0;
    let maxCounterNonFill = 0;
    let totalPrimaryAll = 0;
    let maxCounterAll = 0;

    measured.forEach(m => {
        const primarySize = isHorizontal ? m.intrinsicW : m.intrinsicH;
        const counterSize = isHorizontal ? m.intrinsicH : m.intrinsicW;

        totalPrimaryAll += primarySize;
        maxCounterAll = Math.max(maxCounterAll, counterSize);

        if (!m.fillPrimary) {
            totalPrimaryNonFill += primarySize;
        }
        if (!m.fillCounter) {
            maxCounterNonFill = Math.max(maxCounterNonFill, counterSize);
        }
    });

    const totalSpacing = Math.max(0, childLayers.length - 1) * spacing;

    // ── Determine intrinsic frame sizes (Hug) ─────────────────
    // For hug, use non-fill children only (fill children adapt to the frame, not vice versa)

    const intrinsicPrimary = (primaryHug ? totalPrimaryNonFill : (isHorizontal ? totalPrimaryAll : totalPrimaryAll)) + totalSpacing;
    const intrinsicCounter = counterHug ? maxCounterNonFill : maxCounterAll;

    let intrinsicFrameWidth: number;
    let intrinsicFrameHeight: number;

    if (isHorizontal) {
        intrinsicFrameWidth = paddingLeft + paddingRight + (primaryHug ? totalPrimaryNonFill + totalSpacing : totalPrimaryAll + totalSpacing);
        intrinsicFrameHeight = paddingTop + paddingBottom + (counterHug ? maxCounterNonFill : maxCounterAll);
    } else {
        intrinsicFrameHeight = paddingTop + paddingBottom + (primaryHug ? totalPrimaryNonFill + totalSpacing : totalPrimaryAll + totalSpacing);
        intrinsicFrameWidth = paddingLeft + paddingRight + (counterHug ? maxCounterNonFill : maxCounterAll);
    }

    // Determine final frame size based on sizing mode
    const finalFrameWidth = (isHorizontal && primaryHug) || (!isHorizontal && counterHug)
        ? intrinsicFrameWidth
        : frame.width;

    const finalFrameHeight = (!isHorizontal && primaryHug) || (isHorizontal && counterHug)
        ? intrinsicFrameHeight
        : frame.height;

    // Check if we need to update frame size
    if (Math.abs(finalFrameWidth - frame.width) > 0.01 || Math.abs(finalFrameHeight - frame.height) > 0.01) {
        updates[frame.id] = { ...updates[frame.id], width: finalFrameWidth, height: finalFrameHeight };
    }

    // ── Second pass: resolve "fill" children ──────────────────

    const primaryFillChildren = measured.filter(m => m.fillPrimary);
    const nonFillPrimaryTotal = measured
        .filter(m => !m.fillPrimary)
        .reduce((acc, m) => acc + (isHorizontal ? m.intrinsicW : m.intrinsicH), 0);

    const availablePrimarySpace = isHorizontal
        ? finalFrameWidth - paddingLeft - paddingRight - totalSpacing - nonFillPrimaryTotal
        : finalFrameHeight - paddingTop - paddingBottom - totalSpacing - nonFillPrimaryTotal;

    const fillPrimarySize = primaryFillChildren.length > 0
        ? Math.max(1, availablePrimarySpace / primaryFillChildren.length)
        : 0;

    // Build computed children with resolved sizes
    interface ComputedChild {
        id: string;
        w: number;
        h: number;
        x: number;
        y: number;
    }

    const computedChildren: ComputedChild[] = measured.map(m => {
        let w = m.intrinsicW;
        let h = m.intrinsicH;

        // Fill on primary axis
        if (m.fillPrimary) {
            if (isHorizontal) w = fillPrimarySize;
            else h = fillPrimarySize;
        }

        // Fill on counter axis
        if (m.fillCounter) {
            if (isHorizontal) h = finalFrameHeight - paddingTop - paddingBottom;
            else w = finalFrameWidth - paddingLeft - paddingRight;
        }

        // If text child is auto_height and just got a new width via fill, re-measure height
        const originalChild = childLayers.find(c => c.id === m.id);
        if (originalChild && originalChild.type === "text") {
            const textChild = originalChild as TextLayer;
            const adj = textChild.textAdjust || "auto_width";
            if (adj === "auto_height" && Math.abs(w - textChild.width) > 0.01) {
                const est = estimateTextSize(textChild, w);
                h = est.height;
                updates[m.id] = { ...updates[m.id], width: w, height: h };
            }
        }

        // Clamp
        w = Math.max(1, w);
        h = Math.max(1, h);

        return { id: m.id, w, h, x: 0, y: 0 };
    });

    // ── Third pass: positioning ────────────────────────────────

    let currentX = paddingLeft;
    let currentY = paddingTop;

    const resolvedTotalW = computedChildren.reduce((acc, c) => acc + c.w, 0);
    const resolvedTotalH = computedChildren.reduce((acc, c) => acc + c.h, 0);

    // Primary axis alignment
    if (isHorizontal) {
        if (primaryAxisAlignItems === "center") {
            currentX = paddingLeft + (finalFrameWidth - paddingLeft - paddingRight - resolvedTotalW - totalSpacing) / 2;
        } else if (primaryAxisAlignItems === "flex-end") {
            currentX = finalFrameWidth - paddingRight - resolvedTotalW - totalSpacing;
        } else if (primaryAxisAlignItems === "space-between" && computedChildren.length > 1) {
            const flexibleSpacing = (finalFrameWidth - paddingLeft - paddingRight - resolvedTotalW) / (computedChildren.length - 1);
            currentX = paddingLeft;
            computedChildren.forEach(cc => {
                const cy = getCounterAxisOffset(cc.h, finalFrameHeight, paddingTop, paddingBottom, counterAxisAlignItems);
                cc.x = currentX;
                cc.y = cy;
                currentX += cc.w + flexibleSpacing;
            });
            return commitUpdates(updates, childLayers, computedChildren, frame);
        }
    } else {
        if (primaryAxisAlignItems === "center") {
            currentY = paddingTop + (finalFrameHeight - paddingTop - paddingBottom - resolvedTotalH - totalSpacing) / 2;
        } else if (primaryAxisAlignItems === "flex-end") {
            currentY = finalFrameHeight - paddingBottom - resolvedTotalH - totalSpacing;
        } else if (primaryAxisAlignItems === "space-between" && computedChildren.length > 1) {
            const flexibleSpacing = (finalFrameHeight - paddingTop - paddingBottom - resolvedTotalH) / (computedChildren.length - 1);
            currentY = paddingTop;
            computedChildren.forEach(cc => {
                const cx = getCounterAxisOffset(cc.w, finalFrameWidth, paddingLeft, paddingRight, counterAxisAlignItems);
                cc.x = cx;
                cc.y = currentY;
                currentY += cc.h + flexibleSpacing;
            });
            return commitUpdates(updates, childLayers, computedChildren, frame);
        }
    }

    // Standard layout pass
    computedChildren.forEach(cc => {
        if (isHorizontal) {
            cc.x = currentX;
            cc.y = getCounterAxisOffset(cc.h, finalFrameHeight, paddingTop, paddingBottom, counterAxisAlignItems);
            currentX += cc.w + spacing;
        } else {
            cc.x = getCounterAxisOffset(cc.w, finalFrameWidth, paddingLeft, paddingRight, counterAxisAlignItems);
            cc.y = currentY;
            currentY += cc.h + spacing;
        }
    });

    return commitUpdates(updates, childLayers, computedChildren, frame);
}

function getCounterAxisOffset(size: number, frameSize: number, padStart: number, padEnd: number, align: string) {
    if (align === "center") {
        return padStart + (frameSize - padStart - padEnd - size) / 2;
    } else if (align === "flex-end") {
        return frameSize - padEnd - size;
    }
    // "stretch" or "flex-start" starts at padStart 
    // (Note: "stretch" size is handled during Fill logic)
    return padStart;
}

function commitUpdates(
    updates: Record<string, Partial<Layer>>,
    originalLayers: Layer[],
    computed: { id: string, x: number, y: number, w: number, h: number }[],
    frame: FrameLayer
) {
    computed.forEach(cc => {
        const original = originalLayers.find(l => l.id === cc.id);
        if (!original) return;

        const existingUpdate = updates[cc.id] || {};

        // Convert auto-layout local coords to scene absolute coords
        // because the store uses absolute coordinates for all layers.
        const absoluteX = frame.x + cc.x;
        const absoluteY = frame.y + cc.y;

        if (Math.abs(original.x - absoluteX) > 0.01) existingUpdate.x = absoluteX;
        if (Math.abs(original.y - absoluteY) > 0.01) existingUpdate.y = absoluteY;
        if (Math.abs(original.width - cc.w) > 0.01) existingUpdate.width = cc.w;
        if (Math.abs(original.height - cc.h) > 0.01) existingUpdate.height = cc.h;

        if (Object.keys(existingUpdate).length > 0) {
            updates[cc.id] = existingUpdate;
        }
    });
    return updates;
}

/**
 * Applies computeAutoLayout to all frames in the document, bottom-up.
 * Returns a new array of layers with applied coordinates/sizes.
 */
export function applyAllAutoLayouts(layers: Layer[]): Layer[] {
    let updatedLayers = [...layers];

    // Find all frames
    const frames = updatedLayers.filter((l): l is FrameLayer => l.type === "frame");
    if (frames.length === 0) return updatedLayers;

    // Process bottom-up: deepest nested frames first so their sizes
    // are resolved before parent frames measure them.
    const getDepth = (id: string, currentDepth = 0): number => {
        const parent = frames.find(f => f.childIds.includes(id));
        return parent ? getDepth(parent.id, currentDepth + 1) : currentDepth;
    };

    const sortedFrames = frames.sort((a, b) => getDepth(b.id) - getDepth(a.id));

    sortedFrames.forEach(frame => {
        // Need to find the latest version of this frame in updatedLayers
        const currentFrame = updatedLayers.find(l => l.id === frame.id) as FrameLayer;
        if (!currentFrame || !currentFrame.layoutMode || currentFrame.layoutMode === "none") return;

        const updates = computeAutoLayout(currentFrame, updatedLayers);

        if (Object.keys(updates).length > 0) {
            updatedLayers = updatedLayers.map(l => {
                if (updates[l.id]) {
                    return { ...l, ...updates[l.id] } as Layer;
                }
                return l;
            });
        }
    });

    return updatedLayers;
}
