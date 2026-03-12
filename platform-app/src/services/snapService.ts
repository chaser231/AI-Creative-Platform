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
    distance: number;   // pixel distance (always positive)
}

export interface SpacingGuide {
    axis: 'horizontal' | 'vertical';
    gap: number;
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
const SPACING_TOLERANCE = 3; // 3px tolerance for "equal gap" detection

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

        // Also snap right/bottom edges to grid
        const rightEdge = activeNode.x + activeNode.width;
        const bottomEdge = activeNode.y + activeNode.height;
        const gridRightX = Math.round(rightEdge / gs) * gs;
        const gridBottomY = Math.round(bottomEdge / gs) * gs;

        // Pick whichever is closer: snap left edge or right edge
        const diffLeft = Math.abs(activeNode.x - gridX);
        const diffRight = Math.abs(rightEdge - gridRightX);
        if (diffLeft <= diffRight) {
            snappedX = gridX;
        } else {
            snappedX = gridRightX - activeNode.width;
        }

        const diffTop = Math.abs(activeNode.y - gridY);
        const diffBottom = Math.abs(bottomEdge - gridBottomY);
        if (diffTop <= diffBottom) {
            snappedY = gridY;
        } else {
            snappedY = gridBottomY - activeNode.height;
        }
    }

    // ── 2. Artboard Snapping ────────────────────────────────
    const artboardNode: NodeBounds | null = artboardBounds && config.artboardSnap
        ? { id: '__artboard__', x: 0, y: 0, width: artboardBounds.width, height: artboardBounds.height, rotation: 0 }
        : null;

    // ── 3. Object Snapping (including artboard as virtual node) ──
    if (config.objectSnap || artboardNode) {
        const allTargets = config.objectSnap
            ? [...otherNodes, ...(artboardNode ? [artboardNode] : [])]
            : (artboardNode ? [artboardNode] : []);

        const objectSnap = getObjectSnap(activeNode, allTargets, threshold);

        // Object snap overrides grid snap when within threshold
        if (objectSnap.x !== null) {
            snappedX = objectSnap.x;
        }
        if (objectSnap.y !== null) {
            snappedY = objectSnap.y;
        }
        guides.push(...objectSnap.guides);
    }

    // ── 4. Smart Spacing Guides ─────────────────────────────
    if (config.objectSnap && otherNodes.length >= 2) {
        const spacingResult = getSpacingGuides(
            { ...activeNode, x: snappedX ?? activeNode.x, y: snappedY ?? activeNode.y },
            otherNodes,
            threshold
        );
        spacingGuides.push(...spacingResult.spacingGuides);
        // If spacing snap found a better position, use it
        if (spacingResult.snapX !== null) {
            snappedX = spacingResult.snapX;
            guides.push(...spacingResult.guides);
        }
        if (spacingResult.snapY !== null) {
            snappedY = spacingResult.snapY;
            guides.push(...spacingResult.guides);
        }
    }

    // ── 5. Distance Measurement (Alt+drag) ──────────────────
    if (showDistances) {
        const finalNode = {
            ...activeNode,
            x: snappedX ?? activeNode.x,
            y: snappedY ?? activeNode.y,
        };
        const allTargets = [...otherNodes, ...(artboardNode ? [artboardNode] : [])];
        distances.push(...getDistanceMeasurements(finalNode, allTargets));
    }

    // ── 6. Pixel Rounding (final pass) ──────────────────────
    if (config.pixelSnap) {
        if (snappedX !== null) snappedX = Math.round(snappedX);
        if (snappedY !== null) snappedY = Math.round(snappedY);

        // Even if no snap happened, round the proposed position
        if (snappedX === null) snappedX = Math.round(activeNode.x);
        if (snappedY === null) snappedY = Math.round(activeNode.y);
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
): { x: number | null; y: number | null; guides: SnapGuide[] } {
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

    return { x: snappedX, y: snappedY, guides };
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
    const aCenterY = activeNode.y + activeNode.height / 2;
    const aCenterX = activeNode.x + activeNode.width / 2;

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

function getSpacingGuides(
    activeNode: NodeBounds,
    otherNodes: NodeBounds[],
    threshold: number
): { spacingGuides: SpacingGuide[]; snapX: number | null; snapY: number | null; guides: SnapGuide[] } {
    const spacingGuides: SpacingGuide[] = [];
    let snapX: number | null = null;
    let snapY: number | null = null;
    const guides: SnapGuide[] = [];

    // Get all nodes including active, sorted by position
    const allNodes = [...otherNodes]; // don't include active for gap calculation between others

    if (allNodes.length < 2) return { spacingGuides, snapX, snapY, guides };

    // ── Horizontal spacing ──────────────────────────────
    // Sort other nodes by X position
    const sortedX = [...allNodes].sort((a, b) => a.x - b.x);

    // Compute gaps between consecutive other nodes (horizontally adjacent)
    const xGaps: { from: NodeBounds; to: NodeBounds; gap: number }[] = [];
    for (let i = 0; i < sortedX.length - 1; i++) {
        const a = sortedX[i];
        const b = sortedX[i + 1];
        const gap = b.x - (a.x + a.width);
        if (gap > 0) {
            xGaps.push({ from: a, to: b, gap });
        }
    }

    // Check if active node can be placed to create an equal gap with any existing gap
    for (const gapInfo of xGaps) {
        // Could active fit to the left of gapInfo.from with same gap?
        const leftTarget = gapInfo.from.x - gapInfo.gap - activeNode.width;
        if (Math.abs(activeNode.x - leftTarget) < threshold) {
            snapX = leftTarget;
            const midY = Math.min(activeNode.y, gapInfo.from.y, gapInfo.to.y);
            const maxY = Math.max(
                activeNode.y + activeNode.height,
                gapInfo.from.y + gapInfo.from.height,
                gapInfo.to.y + gapInfo.to.height
            );
            spacingGuides.push({
                axis: 'horizontal',
                gap: gapInfo.gap,
                segments: [
                    { from: leftTarget + activeNode.width, to: gapInfo.from.x, crossPos: (midY + maxY) / 2 },
                    { from: gapInfo.from.x + gapInfo.from.width, to: gapInfo.to.x, crossPos: (midY + maxY) / 2 },
                ],
            });
            break;
        }

        // Could active fit to the right of gapInfo.to with same gap?
        const rightTarget = gapInfo.to.x + gapInfo.to.width + gapInfo.gap;
        if (Math.abs(activeNode.x - rightTarget) < threshold) {
            snapX = rightTarget;
            const midY = Math.min(activeNode.y, gapInfo.from.y, gapInfo.to.y);
            const maxY = Math.max(
                activeNode.y + activeNode.height,
                gapInfo.from.y + gapInfo.from.height,
                gapInfo.to.y + gapInfo.to.height
            );
            spacingGuides.push({
                axis: 'horizontal',
                gap: gapInfo.gap,
                segments: [
                    { from: gapInfo.from.x + gapInfo.from.width, to: gapInfo.to.x, crossPos: (midY + maxY) / 2 },
                    { from: gapInfo.to.x + gapInfo.to.width, to: rightTarget, crossPos: (midY + maxY) / 2 },
                ],
            });
            break;
        }

        // Could active fit between from and to, splitting the gap equally?
        const betweenLeft = gapInfo.from.x + gapInfo.from.width;
        const betweenRight = gapInfo.to.x;
        const totalSpace = betweenRight - betweenLeft;
        const equalGap = (totalSpace - activeNode.width) / 2;
        if (equalGap > 0) {
            const betweenTarget = betweenLeft + equalGap;
            if (Math.abs(activeNode.x - betweenTarget) < threshold) {
                snapX = betweenTarget;
                const midY = Math.min(activeNode.y, gapInfo.from.y, gapInfo.to.y);
                const maxY = Math.max(
                    activeNode.y + activeNode.height,
                    gapInfo.from.y + gapInfo.from.height,
                    gapInfo.to.y + gapInfo.to.height
                );
                spacingGuides.push({
                    axis: 'horizontal',
                    gap: Math.round(equalGap),
                    segments: [
                        { from: betweenLeft, to: betweenTarget, crossPos: (midY + maxY) / 2 },
                        { from: betweenTarget + activeNode.width, to: betweenRight, crossPos: (midY + maxY) / 2 },
                    ],
                });
                break;
            }
        }
    }

    // ── Vertical spacing (same logic, rotated) ──────────
    const sortedY = [...allNodes].sort((a, b) => a.y - b.y);

    const yGaps: { from: NodeBounds; to: NodeBounds; gap: number }[] = [];
    for (let i = 0; i < sortedY.length - 1; i++) {
        const a = sortedY[i];
        const b = sortedY[i + 1];
        const gap = b.y - (a.y + a.height);
        if (gap > 0) {
            yGaps.push({ from: a, to: b, gap });
        }
    }

    for (const gapInfo of yGaps) {
        const topTarget = gapInfo.from.y - gapInfo.gap - activeNode.height;
        if (Math.abs(activeNode.y - topTarget) < threshold) {
            snapY = topTarget;
            const midX = Math.min(activeNode.x, gapInfo.from.x, gapInfo.to.x);
            const maxX = Math.max(
                activeNode.x + activeNode.width,
                gapInfo.from.x + gapInfo.from.width,
                gapInfo.to.x + gapInfo.to.width
            );
            spacingGuides.push({
                axis: 'vertical',
                gap: gapInfo.gap,
                segments: [
                    { from: topTarget + activeNode.height, to: gapInfo.from.y, crossPos: (midX + maxX) / 2 },
                    { from: gapInfo.from.y + gapInfo.from.height, to: gapInfo.to.y, crossPos: (midX + maxX) / 2 },
                ],
            });
            break;
        }

        const bottomTarget = gapInfo.to.y + gapInfo.to.height + gapInfo.gap;
        if (Math.abs(activeNode.y - bottomTarget) < threshold) {
            snapY = bottomTarget;
            const midX = Math.min(activeNode.x, gapInfo.from.x, gapInfo.to.x);
            const maxX = Math.max(
                activeNode.x + activeNode.width,
                gapInfo.from.x + gapInfo.from.width,
                gapInfo.to.x + gapInfo.to.width
            );
            spacingGuides.push({
                axis: 'vertical',
                gap: gapInfo.gap,
                segments: [
                    { from: gapInfo.from.y + gapInfo.from.height, to: gapInfo.to.y, crossPos: (midX + maxX) / 2 },
                    { from: gapInfo.to.y + gapInfo.to.height, to: bottomTarget, crossPos: (midX + maxX) / 2 },
                ],
            });
            break;
        }

        // Between
        const betweenTop = gapInfo.from.y + gapInfo.from.height;
        const betweenBottom = gapInfo.to.y;
        const totalSpace = betweenBottom - betweenTop;
        const equalGap = (totalSpace - activeNode.height) / 2;
        if (equalGap > 0) {
            const betweenTarget = betweenTop + equalGap;
            if (Math.abs(activeNode.y - betweenTarget) < threshold) {
                snapY = betweenTarget;
                const midX = Math.min(activeNode.x, gapInfo.from.x, gapInfo.to.x);
                const maxX = Math.max(
                    activeNode.x + activeNode.width,
                    gapInfo.from.x + gapInfo.from.width,
                    gapInfo.to.x + gapInfo.to.width
                );
                spacingGuides.push({
                    axis: 'vertical',
                    gap: Math.round(equalGap),
                    segments: [
                        { from: betweenTop, to: betweenTarget, crossPos: (midX + maxX) / 2 },
                        { from: betweenTarget + activeNode.height, to: betweenBottom, crossPos: (midX + maxX) / 2 },
                    ],
                });
                break;
            }
        }
    }

    return { spacingGuides, snapX, snapY, guides };
}
