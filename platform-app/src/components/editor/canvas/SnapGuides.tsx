"use client";

import { Fragment } from "react";
import { Line, Rect, Text } from "react-konva";
import type { SnapResult, DistanceMeasurement, SpacingGuide } from "@/services/snapService";

interface SnapGuidesProps {
    snapLines: SnapResult["guides"];
    distanceMeasurements: DistanceMeasurement[];
    spacingGuides: SpacingGuide[];
    selectionBox: { x: number; y: number; width: number; height: number } | null;
}

export function SnapGuides({ snapLines, distanceMeasurements, spacingGuides, selectionBox }: SnapGuidesProps) {
    return (
        <>
            {/* Snap Guides */}
            {snapLines.map((guide, i) => (
                <Line
                    key={`snap-${i}`}
                    points={
                        guide.orientation === 'vertical'
                            ? [guide.position, guide.start, guide.position, guide.end]
                            : [guide.start, guide.position, guide.end, guide.position]
                    }
                    stroke={guide.type === 'artboard' ? '#6366F1' : '#ff0000'}
                    strokeWidth={1}
                    dash={[4, 4]}
                    listening={false}
                />
            ))}

            {/* Distance Measurements (Alt+drag) */}
            {distanceMeasurements.map((dm, i) => {
                const isHz = dm.axis === 'horizontal';
                const points = isHz
                    ? [dm.from, dm.position, dm.to, dm.position]
                    : [dm.position, dm.from, dm.position, dm.to];
                const labelX = isHz ? (dm.from + dm.to) / 2 : dm.position + 4;
                const labelY = isHz ? dm.position - 14 : (dm.from + dm.to) / 2 - 6;
                return (
                    <Fragment key={`dist-group-${i}`}>
                        <Line
                            key={`dist-line-${i}`}
                            points={points}
                            stroke="#F97316"
                            strokeWidth={1}
                            listening={false}
                        />
                        {/* End caps */}
                        {isHz ? (
                            <Fragment key={`dist-caps-hz-${i}`}>
                                <Line key={`dist-cap-a-${i}`} points={[dm.from, dm.position - 4, dm.from, dm.position + 4]} stroke="#F97316" strokeWidth={1} listening={false} />
                                <Line key={`dist-cap-b-${i}`} points={[dm.to, dm.position - 4, dm.to, dm.position + 4]} stroke="#F97316" strokeWidth={1} listening={false} />
                            </Fragment>
                        ) : (
                            <>
                                <Line key={`dist-cap-a-${i}`} points={[dm.position - 4, dm.from, dm.position + 4, dm.from]} stroke="#F97316" strokeWidth={1} listening={false} />
                                <Line key={`dist-cap-b-${i}`} points={[dm.position - 4, dm.to, dm.position + 4, dm.to]} stroke="#F97316" strokeWidth={1} listening={false} />
                            </>
                        )}
                        {/* Distance label */}
                        <Rect
                            key={`dist-bg-${i}`}
                            x={labelX - 22}
                            y={labelY - 4}
                            width={44}
                            height={20}
                            fill="#F97316"
                            cornerRadius={4}
                            listening={false}
                        />
                        <Text
                            key={`dist-label-${i}`}
                            x={labelX - 22}
                            y={labelY + 1}
                            width={44}
                            text={`${Number(dm.distance.toFixed(1))}`}
                            fontSize={11}
                            fontFamily="Inter, sans-serif"
                            fill="#fff"
                            align="center"
                            listening={false}
                        />
                    </Fragment>
                );
            })}

            {/* Smart Spacing Guides */}
            {spacingGuides.map((sg, i) =>
                sg.segments.map((seg, j) => {
                    const isHz = sg.axis === 'horizontal';
                    const points = isHz
                        ? [seg.from, seg.crossPos, seg.to, seg.crossPos]
                        : [seg.crossPos, seg.from, seg.crossPos, seg.to];
                    const labelX = isHz ? (seg.from + seg.to) / 2 : seg.crossPos + 4;
                    const labelY = isHz ? seg.crossPos - 14 : (seg.from + seg.to) / 2 - 6;
                    return (
                        <Fragment key={`spc-group-${i}-${j}`}>
                            <Line
                                key={`spc-line-${i}-${j}`}
                                points={points}
                                stroke="#EC4899"
                                strokeWidth={1}
                                dash={[2, 2]}
                                listening={false}
                            />
                            <Rect
                                key={`spc-bg-${i}-${j}`}
                                x={labelX - 22}
                                y={labelY - 4}
                                width={44}
                                height={20}
                                fill="#EC4899"
                                cornerRadius={4}
                                listening={false}
                            />
                            <Text
                                key={`spc-label-${i}-${j}`}
                                x={labelX - 22}
                                y={labelY + 1}
                                width={44}
                                text={`${Number(sg.gap.toFixed(1))}`}
                                fontSize={11}
                                fontFamily="Inter, sans-serif"
                                fill="#fff"
                                align="center"
                                listening={false}
                            />
                        </Fragment>
                    );
                })
            )}

            {/* Selection Box */}
            {selectionBox && (
                <Rect
                    x={selectionBox.x}
                    y={selectionBox.y}
                    width={selectionBox.width}
                    height={selectionBox.height}
                    fill="rgba(99, 102, 241, 0.2)"
                    stroke="#6366F1"
                    strokeWidth={1}
                    listening={false}
                />
            )}
        </>
    );
}
