export interface SnapGuide {
    orientation: 'vertical' | 'horizontal';
    position: number;
    start: number;
    end: number;
}

export interface SnapResult {
    x: number | null;
    y: number | null;
    guides: SnapGuide[];
}

const SNAP_THRESHOLD = 5;

interface NodeBounds {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
}

export function getSnapLines(
    activeNode: NodeBounds,
    otherNodes: NodeBounds[],
    threshold: number = SNAP_THRESHOLD
): SnapResult {
    const guides: SnapGuide[] = [];
    let snappedX: number | null = null;
    let snappedY: number | null = null;

    // Define edges for active node
    const activeEdges = {
        vertical: [
            { guide: activeNode.x, offset: 0, text: 'start' },
            { guide: activeNode.x + activeNode.width / 2, offset: -activeNode.width / 2, text: 'center' },
            { guide: activeNode.x + activeNode.width, offset: -activeNode.width, text: 'end' },
        ],
        horizontal: [
            { guide: activeNode.y, offset: 0, text: 'start' },
            { guide: activeNode.y + activeNode.height / 2, offset: -activeNode.height / 2, text: 'center' },
            { guide: activeNode.y + activeNode.height, offset: -activeNode.height, text: 'end' },
        ],
    };

    // Find closest vertical snap
    let minDiffX = threshold + 1;
    let bestSnapX: { guide: number, offset: number, start: number, end: number } | null = null;

    otherNodes.forEach(node => {
        const edges = [
            node.x,
            node.x + node.width / 2,
            node.x + node.width
        ];

        activeEdges.vertical.forEach(activeEdge => {
            edges.forEach(targetEdge => {
                const diff = Math.abs(activeEdge.guide - targetEdge);
                if (diff < minDiffX) {
                    minDiffX = diff;
                    bestSnapX = {
                        guide: targetEdge,
                        offset: activeEdge.offset,
                        // Guide reaches from min Y to max Y of both nodes
                        start: Math.min(activeNode.y, node.y),
                        end: Math.max(activeNode.y + activeNode.height, node.y + node.height)
                    };
                }
            });
        });
    });

    if (bestSnapX) {
        snappedX = bestSnapX.guide + bestSnapX.offset;
        guides.push({
            orientation: 'vertical',
            position: bestSnapX.guide,
            start: bestSnapX.start,
            end: bestSnapX.end
        });
    }

    // Find closest horizontal snap
    let minDiffY = threshold + 1;
    let bestSnapY: { guide: number, offset: number, start: number, end: number } | null = null;

    otherNodes.forEach(node => {
        const edges = [
            node.y,
            node.y + node.height / 2,
            node.y + node.height
        ];

        activeEdges.horizontal.forEach(activeEdge => {
            edges.forEach(targetEdge => {
                const diff = Math.abs(activeEdge.guide - targetEdge);
                if (diff < minDiffY) {
                    minDiffY = diff;
                    bestSnapY = {
                        guide: targetEdge,
                        offset: activeEdge.offset,
                        start: Math.min(activeNode.x, node.x),
                        end: Math.max(activeNode.x + activeNode.width, node.x + node.width)
                    };
                }
            });
        });
    });

    if (bestSnapY) {
        snappedY = bestSnapY.guide + bestSnapY.offset;
        guides.push({
            orientation: 'horizontal',
            position: bestSnapY.guide,
            start: bestSnapY.start,
            end: bestSnapY.end
        });
    }

    return { x: snappedX, y: snappedY, guides };
}
