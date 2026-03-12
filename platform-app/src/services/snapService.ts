// ─── Types ──────────────────────────────────────────────────

export interface SnapGuide {
    orientation: 'vertical' | 'horizontal';
    position: number;
    start: number;
    end: number;
    type?: 'edge' | 'center' | 'artboard' | 'grid' | 'spacing';
}

export interface DistanceMeasurement {
    axis: 'horizontal' | 'vertical';
    from: number;       // start coordinate on measuring axis
    to: number;         // end coordinate on measuring axis
    position: number;   // cross-axis position for the label
    distance: number;   // pixel distance (always positive, integer)
}

export interface SpacingGuide {
    axis: 'horizontal' | 'vertical';
    gap: number;        // always integer
    // Pairs of object edges that share the same gap
    segments: { from: number; to: number; crossPos: number }[];
}

export interface SnapConfig {
    objectSnap: boolean;
    gridSnap: boolean;
    gridSize: number;
    pixelSnap: boolean;
    artboardSnap: boolean;
}

export interface SnapResult {
    x: number | null;
    y: number | null;
    guides: SnapGuide[];
    distances: DistanceMeasurement[];
    spacingGuides: SpacingGuide[];
}

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
    objectSnap: true,
    gridSnap: false,
    gridSize: 8,
    pixelSnap: true,
    artboardSnap: true,
};

const SNAP_THRESHOLD = 5;

export interface NodeBounds {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
}

// ─── Main Snap Function ─────────────────────────────────────

export function computeSnap(
    activeNode: NodeBounds,
    otherNodes: NodeBounds[],
    config: SnapConfig,
    artboardBounds?: { width: number; height: number },
    showDistances: boolean = false,
    threshold: number = SNAP_THRESHOLD
): SnapResult {
    let snappedX: number | null = null;
    let snappedY: number | null = null;
    const guides: SnapGuide[] = [];
    const distances: DistanceMeasurement[] = [];
    const spacingGuides: SpacingGuide[] = [];

    // ── 1. Grid Snapping ────────────────────────────────────
    if (config.gridSnap && config.gridSize > 0) {
        const gs = config.gridSize;
        const gridX = Math.round(activeNode.x / gs) * gs;
        const gridY = Math.round(activeNode.y / gs) * gs;

        const rightEdge = activeNode.x + activeNode.width;
        const bottomEdge = activeNode.y + activeNode.height;
        const gridRightX = Math.round(rightEdge / gs) * gs;
        const gridBottomY = Math.round(bottomEdge / gs) * gs;

        const diffLeft = Math.abs(activeNode.x - gridX);
        const diffRight = Math.abs(rightEdge - gridRightX);
        snappedX = diffLeft <= diffRight ? gridX : gridRightX - activeNode.width;

        const diffTop = Math.abs(activeNode.y - gridY);
        const diffBottom = Math.abs(bottomEdge - gridBottomY);
        snappedY = diffTop <= diffBottom ? gridY : gridBottomY - activeNode.height;
    }

    // ── 2. Artboard Snapping ────────────────────────────────
    const artboardNode: NodeBounds | null = artboardBounds && config.artboardSnap
        ? { id: '__artboard__', x: 0, y: 0, width: artboardBounds.width, height: artboardBounds.height, rotation: 0 }
        : null;

    // ── 3. Object Snapping (including artboard as virtual node) ──
    let objectSnapDiffX = Infinity;
    let objectSnapDiffY = Infinity;

    if (config.objectSnap || artboardNode) {
        const allTargets = config.objectSnap
            ? [...otherNodes, ...(artboardNode ? [artboardNode] : [])]
            : (artboardNode ? [artboardNode] : []);

        const objectSnap = getObjectSnap(activeNode, allTargets, threshold);

        // Object snap overrides grid snap when within threshold
        if (objectSnap.x !== null) {
            snappedX = objectSnap.x;
            objectSnapDiffX = objectSnap.diffX;
        }
        if (objectSnap.y !== null) {
            snappedY = objectSnap.y;
            objectSnapDiffY = objectSnap.diffY;
        }
        guides.push(...objectSnap.guides);
    }

    // ── 4. Smart Spacing Guides ─────────────────────────────
    // Only run if objectSnap is enabled and we have at least 2 other objects
    if (config.objectSnap && otherNodes.length >= 2) {
        // Use the current best snapped position
        const currentX = snappedX ?? activeNode.x;
        const currentY = snappedY ?? activeNode.y;

        const spacingResult = getSpacingGuides(
            { ...activeNode, x: currentX, y: currentY },
            otherNodes,
            threshold,
            config.pixelSnap
        );

        // Spacing snap only wins over object snap if object snap was not active
        // or if the spacing snap is closer
        if (spacingResult.snapX !== null) {
            const spacingDiffX = Math.abs(activeNode.x - spacingResult.snapX);
            // Only override if object snap wasn't set or spacing is at least as close
            if (objectSnapDiffX > threshold || spacingDiffX <= objectSnapDiffX) {
                snappedX = spacingResult.snapX;
            }
        }
        if (spacingResult.snapY !== null) {
            const spacingDiffY = Math.abs(activeNode.y - spacingResult.snapY);
            if (objectSnapDiffY > threshold || spacingDiffY <= objectSnapDiffY) {
                snappedY = spacingResult.snapY;
            }
        }
        // Always show spacing guides if they exist (even if we didn't adopt the snap position)
        spacingGuides.push(...spacingResult.spacingGuides);
    }

    // ── 5. Pixel Rounding (before distance measurement so distances are accurate) ──
    if (config.pixelSnap) {
        if (snappedX !== null) snappedX = Math.round(snappedX);
        if (snappedY !== null) snappedY = Math.round(snappedY);

        // Even if no snap happened, round the proposed position
        if (snappedX === null) snappedX = Math.round(activeNode.x);
        if (snappedY === null) snappedY = Math.round(activeNode.y);
    }

    // ── 6. Distance Measurement (Alt+drag) — AFTER pixel rounding ──
    if (showDistances) {
        const finalNode = {
            ...activeNode,
            x: snappedX ?? activeNode.x,
            y: snappedY ?? activeNode.y,
        };
        const allTargets = [...otherNodes, ...(artboardNode ? [artboardNode] : [])];
        distances.push(...getDistanceMeasurements(finalNode, allTargets));
    }

    return { x: snappedX, y: snappedY, guides, distances, spacingGuides };
}

// ─── Legacy API (backward-compatible) ───────────────────────

export function getSnapLines(
    activeNode: NodeBounds,
    otherNodes: NodeBounds[],
    threshold: number = SNAP_THRESHOLD
): { x: number | null; y: number | null; guides: SnapGuide[] } {
    const result = computeSnap(activeNode, otherNodes, {
        objectSnap: true,
        gridSnap: false,
        gridSize: 8,
        pixelSnap: false,
        artboardSnap: false,
    }, undefined, false, threshold);
    return { x: result.x, y: result.y, guides: result.guides };
}

// ─── Object Edge/Center Snapping ────────────────────────────

function getObjectSnap(
    activeNode: NodeBounds,
    otherNodes: NodeBounds[],
    threshold: number
): { x: number | null; y: number | null; diffX: number; diffY: number; guides: SnapGuide[] } {
    const guides: SnapGuide[] = [];
    let snappedX: number | null = null;
    let snappedY: number | null = null;

    // Active node edges
    const activeEdgesX = [
        { pos: activeNode.x, offset: 0 },                                              // left
        { pos: activeNode.x + activeNode.width / 2, offset: -activeNode.width / 2 },    // center
        { pos: activeNode.x + activeNode.width, offset: -activeNode.width },             // right
    ];
    const activeEdgesY = [
        { pos: activeNode.y, offset: 0 },                                               // top
        { pos: activeNode.y + activeNode.height / 2, offset: -activeNode.height / 2 },   // center
        { pos: activeNode.y + activeNode.height, offset: -activeNode.height },            // bottom
    ];

    // Find closest X snap
    let minDiffX = threshold + 1;
    let bestX: { guide: number; offset: number; start: number; end: number; type: SnapGuide['type'] } | null = null;

    for (const node of otherNodes) {
        const isArtboard = node.id === '__artboard__';
        const targetEdgesX = [node.x, node.x + node.width / 2, node.x + node.width];

        for (const ae of activeEdgesX) {
            for (const te of targetEdgesX) {
                const diff = Math.abs(ae.pos - te);
                if (diff < minDiffX) {
                    minDiffX = diff;
                    bestX = {
                        guide: te,
                        offset: ae.offset,
                        start: Math.min(activeNode.y, node.y),
                        end: Math.max(activeNode.y + activeNode.height, node.y + node.height),
                        type: isArtboard ? 'artboard' : (Math.abs(te - (node.x + node.width / 2)) < 0.1 ? 'center' : 'edge'),
                    };
                }
            }
        }
    }

    if (bestX) {
        snappedX = bestX.guide + bestX.offset;
        guides.push({
            orientation: 'vertical',
            position: bestX.guide,
            start: bestX.start,
            end: bestX.end,
            type: bestX.type,
        });
    }

    // Find closest Y snap
    let minDiffY = threshold + 1;
    let bestY: { guide: number; offset: number; start: number; end: number; type: SnapGuide['type'] } | null = null;

    for (const node of otherNodes) {
        const isArtboard = node.id === '__artboard__';
        const targetEdgesY = [node.y, node.y + node.height / 2, node.y + node.height];

        for (const ae of activeEdgesY) {
            for (const te of targetEdgesY) {
                const diff = Math.abs(ae.pos - te);
                if (diff < minDiffY) {
                    minDiffY = diff;
                    bestY = {
                        guide: te,
                        offset: ae.offset,
                        start: Math.min(activeNode.x, node.x),
                        end: Math.max(activeNode.x + activeNode.width, node.x + node.width),
                        type: isArtboard ? 'artboard' : (Math.abs(te - (node.y + node.height / 2)) < 0.1 ? 'center' : 'edge'),
                    };
                }
            }
        }
    }

    if (bestY) {
        snappedY = bestY.guide + bestY.offset;
        guides.push({
            orientation: 'horizontal',
            position: bestY.guide,
            start: bestY.start,
            end: bestY.end,
            type: bestY.type,
        });
    }

    return { x: snappedX, y: snappedY, diffX: minDiffX, diffY: minDiffY, guides };
}

// ─── Distance Measurement ───────────────────────────────────

function getDistanceMeasurements(
    activeNode: NodeBounds,
    otherNodes: NodeBounds[]
): DistanceMeasurement[] {
    const measurements: DistanceMeasurement[] = [];

    const aLeft = activeNode.x;
    const aRight = activeNode.x + activeNode.width;
    const aTop = activeNode.y;
    const aBottom = activeNode.y + activeNode.height;

    for (const node of otherNodes) {
        const bLeft = node.x;
        const bRight = node.x + node.width;
        const bTop = node.y;
        const bBottom = node.y + node.height;

        // Check vertical overlap (needed for horizontal distance)
        const vertOverlap = aTop < bBottom && aBottom > bTop;
        // Check horizontal overlap (needed for vertical distance)
        const horizOverlap = aLeft < bRight && aRight > bLeft;

        if (vertOverlap) {
            const crossPos = Math.max(aTop, bTop) + (Math.min(aBottom, bBottom) - Math.max(aTop, bTop)) / 2;

            // Distance to the left
            if (bRight <= aLeft) {
                measurements.push({
                    axis: 'horizontal',
                    from: bRight,
                    to: aLeft,
                    position: crossPos,
                    distance: Math.round(aLeft - bRight),
                });
            }
            // Distance to the right
            if (bLeft >= aRight) {
                measurements.push({
                    axis: 'horizontal',
                    from: aRight,
                    to: bLeft,
                    position: crossPos,
                    distance: Math.round(bLeft - aRight),
                });
            }
        }

        if (horizOverlap) {
            const crossPos = Math.max(aLeft, bLeft) + (Math.min(aRight, bRight) - Math.max(aLeft, bLeft)) / 2;

            // Distance above
            if (bBottom <= aTop) {
                measurements.push({
                    axis: 'vertical',
                    from: bBottom,
                    to: aTop,
                    position: crossPos,
                    distance: Math.round(aTop - bBottom),
                });
            }
            // Distance below
            if (bTop >= aBottom) {
                measurements.push({
                    axis: 'vertical',
                    from: aBottom,
                    to: bTop,
                    position: crossPos,
                    distance: Math.round(bTop - aBottom),
                });
            }
        }
    }

    // Keep only the closest measurement per direction (left, right, top, bottom)
    const closest: DistanceMeasurement[] = [];
    const byDirection = {
        left: measurements.filter(m => m.axis === 'horizontal' && m.to <= activeNode.x + 1),
        right: measurements.filter(m => m.axis === 'horizontal' && m.from >= activeNode.x + activeNode.width - 1),
        top: measurements.filter(m => m.axis === 'vertical' && m.to <= activeNode.y + 1),
        bottom: measurements.filter(m => m.axis === 'vertical' && m.from >= activeNode.y + activeNode.height - 1),
    };

    for (const dir of Object.values(byDirection)) {
        if (dir.length > 0) {
            dir.sort((a, b) => a.distance - b.distance);
            closest.push(dir[0]);
        }
    }

    return closest;
}

// ─── Smart Spacing Guides ───────────────────────────────────

/**
 * Checks if two nodes overlap on the cross-axis (i.e. they are roughly
 * "in the same row" for horizontal gaps, or "in the same column" for vertical).
 * Uses a generous overlap check: the vertical extent of one must overlap the other.
 */
function hasCrossAxisOverlap(
    a: NodeBounds,
    b: NodeBounds,
    axis: 'horizontal' | 'vertical'
): boolean {
    if (axis === 'horizontal') {
        // For horizontal gap analysis, check Y overlap
        return a.y < b.y + b.height && a.y + a.height > b.y;
    } else {
        // For vertical gap analysis, check X overlap
        return a.x < b.x + b.width && a.x + a.width > b.x;
    }
}

function getSpacingGuides(
    activeNode: NodeBounds,
    otherNodes: NodeBounds[],
    threshold: number,
    pixelSnap: boolean
): { spacingGuides: SpacingGuide[]; snapX: number | null; snapY: number | null } {
    const spacingGuides: SpacingGuide[] = [];
    let snapX: number | null = null;
    let snapY: number | null = null;

    if (otherNodes.length < 2) return { spacingGuides, snapX, snapY };

    // ── Horizontal spacing ──────────────────────────────
    const sortedX = [...otherNodes].sort((a, b) => a.x - b.x);

    // Compute gaps between consecutive nodes that overlap on Y axis
    const xGaps: { from: NodeBounds; to: NodeBounds; gap: number }[] = [];
    for (let i = 0; i < sortedX.length - 1; i++) {
        const a = sortedX[i];
        const b = sortedX[i + 1];
        const gap = b.x - (a.x + a.width);
        // Only consider positive gaps between objects that share Y range
        if (gap > 0 && hasCrossAxisOverlap(a, b, 'horizontal')) {
            xGaps.push({ from: a, to: b, gap: Math.round(gap) });
        }
    }

    // Try each xGap: can the active node create an equal gap?
    for (const gapInfo of xGaps) {
        const roundedGap = gapInfo.gap; // already rounded

        // Also check that active node is roughly on the same Y range
        if (!hasCrossAxisOverlap(activeNode, gapInfo.from, 'horizontal') &&
            !hasCrossAxisOverlap(activeNode, gapInfo.to, 'horizontal')) {
            continue;
        }

        const crossY = getCrossAxisCenter([activeNode, gapInfo.from, gapInfo.to], 'horizontal');

        // Option A: active placed to the LEFT of gapInfo.from
        const leftTarget = gapInfo.from.x - roundedGap - activeNode.width;
        if (Math.abs(activeNode.x - leftTarget) < threshold) {
            snapX = pixelSnap ? Math.round(leftTarget) : leftTarget;
            spacingGuides.push({
                axis: 'horizontal',
                gap: roundedGap,
                segments: [
                    { from: snapX + activeNode.width, to: gapInfo.from.x, crossPos: crossY },
                    { from: gapInfo.from.x + gapInfo.from.width, to: gapInfo.to.x, crossPos: crossY },
                ],
            });
            break;
        }

        // Option B: active placed to the RIGHT of gapInfo.to
        const rightTarget = gapInfo.to.x + gapInfo.to.width + roundedGap;
        if (Math.abs(activeNode.x - rightTarget) < threshold) {
            snapX = pixelSnap ? Math.round(rightTarget) : rightTarget;
            spacingGuides.push({
                axis: 'horizontal',
                gap: roundedGap,
                segments: [
                    { from: gapInfo.from.x + gapInfo.from.width, to: gapInfo.to.x, crossPos: crossY },
                    { from: gapInfo.to.x + gapInfo.to.width, to: snapX, crossPos: crossY },
                ],
            });
            break;
        }

        // Option C: active placed BETWEEN from and to, splitting the gap equally
        const betweenLeft = gapInfo.from.x + gapInfo.from.width;
        const betweenRight = gapInfo.to.x;
        const totalSpace = betweenRight - betweenLeft;
        const equalGap = (totalSpace - activeNode.width) / 2;
        if (equalGap > 2) { // minimum 2px gap to be meaningful
            const betweenTarget = betweenLeft + equalGap;
            const roundedTarget = pixelSnap ? Math.round(betweenTarget) : betweenTarget;
            if (Math.abs(activeNode.x - roundedTarget) < threshold) {
                snapX = roundedTarget;
                // Recalculate actual gaps after rounding
                const gapLeft = snapX - betweenLeft;
                const gapRight = betweenRight - (snapX + activeNode.width);
                const displayGap = Math.round((gapLeft + gapRight) / 2);
                spacingGuides.push({
                    axis: 'horizontal',
                    gap: displayGap,
                    segments: [
                        { from: betweenLeft, to: snapX, crossPos: crossY },
                        { from: snapX + activeNode.width, to: betweenRight, crossPos: crossY },
                    ],
                });
                break;
            }
        }
    }

    // ── Vertical spacing ──────────────────────────────
    const sortedY = [...otherNodes].sort((a, b) => a.y - b.y);

    const yGaps: { from: NodeBounds; to: NodeBounds; gap: number }[] = [];
    for (let i = 0; i < sortedY.length - 1; i++) {
        const a = sortedY[i];
        const b = sortedY[i + 1];
        const gap = b.y - (a.y + a.height);
        if (gap > 0 && hasCrossAxisOverlap(a, b, 'vertical')) {
            yGaps.push({ from: a, to: b, gap: Math.round(gap) });
        }
    }

    for (const gapInfo of yGaps) {
        const roundedGap = gapInfo.gap;

        if (!hasCrossAxisOverlap(activeNode, gapInfo.from, 'vertical') &&
            !hasCrossAxisOverlap(activeNode, gapInfo.to, 'vertical')) {
            continue;
        }

        const crossX = getCrossAxisCenter([activeNode, gapInfo.from, gapInfo.to], 'vertical');

        // Option A: active placed ABOVE gapInfo.from
        const topTarget = gapInfo.from.y - roundedGap - activeNode.height;
        if (Math.abs(activeNode.y - topTarget) < threshold) {
            snapY = pixelSnap ? Math.round(topTarget) : topTarget;
            spacingGuides.push({
                axis: 'vertical',
                gap: roundedGap,
                segments: [
                    { from: snapY + activeNode.height, to: gapInfo.from.y, crossPos: crossX },
                    { from: gapInfo.from.y + gapInfo.from.height, to: gapInfo.to.y, crossPos: crossX },
                ],
            });
            break;
        }

        // Option B: active placed BELOW gapInfo.to
        const bottomTarget = gapInfo.to.y + gapInfo.to.height + roundedGap;
        if (Math.abs(activeNode.y - bottomTarget) < threshold) {
            snapY = pixelSnap ? Math.round(bottomTarget) : bottomTarget;
            spacingGuides.push({
                axis: 'vertical',
                gap: roundedGap,
                segments: [
                    { from: gapInfo.from.y + gapInfo.from.height, to: gapInfo.to.y, crossPos: crossX },
                    { from: gapInfo.to.y + gapInfo.to.height, to: snapY, crossPos: crossX },
                ],
            });
            break;
        }

        // Option C: active placed BETWEEN
        const betweenTop = gapInfo.from.y + gapInfo.from.height;
        const betweenBottom = gapInfo.to.y;
        const totalSpace = betweenBottom - betweenTop;
        const equalGap = (totalSpace - activeNode.height) / 2;
        if (equalGap > 2) {
            const betweenTarget = betweenTop + equalGap;
            const roundedTarget = pixelSnap ? Math.round(betweenTarget) : betweenTarget;
            if (Math.abs(activeNode.y - roundedTarget) < threshold) {
                snapY = roundedTarget;
                const gapTop = snapY - betweenTop;
                const gapBottom = betweenBottom - (snapY + activeNode.height);
                const displayGap = Math.round((gapTop + gapBottom) / 2);
                spacingGuides.push({
                    axis: 'vertical',
                    gap: displayGap,
                    segments: [
                        { from: betweenTop, to: snapY, crossPos: crossX },
                        { from: snapY + activeNode.height, to: betweenBottom, crossPos: crossX },
                    ],
                });
                break;
            }
        }
    }

    return { spacingGuides, snapX, snapY };
}

/** Compute a shared cross-axis center for the spacing guide line */
function getCrossAxisCenter(nodes: NodeBounds[], axis: 'horizontal' | 'vertical'): number {
    if (axis === 'horizontal') {
        const minY = Math.min(...nodes.map(n => n.y));
        const maxY = Math.max(...nodes.map(n => n.y + n.height));
        return (minY + maxY) / 2;
    } else {
        const minX = Math.min(...nodes.map(n => n.x));
        const maxX = Math.max(...nodes.map(n => n.x + n.width));
        return (minX + maxX) / 2;
    }
}
