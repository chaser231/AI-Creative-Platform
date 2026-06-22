"use client";

import { useMemo } from "react";
import { Group, Rect, Line } from "react-konva";
import type { LayoutGrid } from "@/types";
import { computeLayoutGridGeometry } from "@/utils/layoutGrid";

interface LayoutGridLayerProps {
    grids: LayoutGrid[] | undefined;
    width: number;
    height: number;
    /** Current zoom — used to keep uniform grid lines hairline-thin regardless of scale. */
    zoom: number;
    /**
     * Optional Konva node name applied to the wrapping group. In the studio this
     * is `EDITOR_CHROME_NAME` so the overlay is auto-hidden during raster export.
     */
    name?: string;
}

/**
 * Read-only Konva overlay for layout grids (safe zones). Renders semi-transparent
 * bands for columns/rows/container grids and hairline lines for the uniform grid,
 * in artboard (scene) coordinates. Never listens to pointer events.
 */
export function LayoutGridLayer({ grids, width, height, zoom, name }: LayoutGridLayerProps) {
    const lineWidth = 1 / Math.max(zoom, 0.01);

    const visibleGrids = useMemo(
        () => (grids ?? []).filter((g) => g.visible),
        [grids],
    );

    if (visibleGrids.length === 0 || width <= 0 || height <= 0) {
        return name ? <Group name={name} listening={false} /> : null;
    }

    return (
        <Group name={name} listening={false}>
            {visibleGrids.map((grid) => {
                const geo = computeLayoutGridGeometry(grid, { width, height });
                // Bands (columns/rows/container) render as filled translucent regions.
                // Lines are drawn only for the uniform grid (which has no bands); for
                // banded grids the edges are used solely as snap targets, not strokes.
                const drawLines = geo.bands.length === 0;
                return (
                    <Group key={grid.id} listening={false}>
                        {geo.bands.map((band, i) => (
                            <Rect
                                key={`b-${i}`}
                                x={band.x}
                                y={band.y}
                                width={band.width}
                                height={band.height}
                                fill={grid.color}
                                opacity={grid.opacity}
                                listening={false}
                                perfectDrawEnabled={false}
                            />
                        ))}
                        {drawLines && geo.lines.vertical.map((x, i) => (
                            <Line
                                key={`v-${i}`}
                                points={[x, 0, x, height]}
                                stroke={grid.color}
                                strokeWidth={lineWidth}
                                opacity={grid.opacity}
                                listening={false}
                                perfectDrawEnabled={false}
                            />
                        ))}
                        {drawLines && geo.lines.horizontal.map((y, i) => (
                            <Line
                                key={`h-${i}`}
                                points={[0, y, width, y]}
                                stroke={grid.color}
                                strokeWidth={lineWidth}
                                opacity={grid.opacity}
                                listening={false}
                                perfectDrawEnabled={false}
                            />
                        ))}
                    </Group>
                );
            })}
        </Group>
    );
}
