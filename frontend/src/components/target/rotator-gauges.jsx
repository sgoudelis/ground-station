/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import * as React from "react";
import {
    GaugeContainer,
    GaugeValueArc,
    GaugeReferenceArc,
    useGaugeState,
    Gauge,
    gaugeClasses,
} from '@mui/x-charts/Gauge';

const isFiniteNumber = (value) => Number.isFinite(value);
const hasFiniteGaugeGeometry = (cx, cy, outerRadius) =>
    [cx, cy, outerRadius].every((value) => Number.isFinite(value));

function GaugePointer() {
    const { valueAngle, outerRadius, cx, cy } = useGaugeState();

    if (!isFiniteNumber(valueAngle) || !hasFiniteGaugeGeometry(cx, cy, outerRadius)) {
        // No value to display
        return null;
    }

    const target = {
        x: cx + outerRadius * Math.sin(valueAngle),
        y: cy - outerRadius * Math.cos(valueAngle),
    };

    return (
        <g>
            {/* Define the filter for drop shadow */}
            <defs>
                <filter id="gauge-pointer-shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="2" dy="2" stdDeviation="2" floodOpacity="0.5" floodColor="rgba(0,0,0,0.5)" />
                </filter>
            </defs>

            {/* Measured position is neutral; red is reserved for restricted zones. */}
            <circle
                cx={cx}
                cy={cy}
                r={5}
                fill="currentColor"
                filter="url(#gauge-pointer-shadow)"
            />
            <path
                d={`M ${cx} ${cy} L ${target.x} ${target.y}`}
                stroke="currentColor"
                strokeWidth={3}
                filter="url(#gauge-pointer-shadow)"
            />
        </g>
    );
}

const EdgeArrow = ({angle, stroke = "currentColor", strokeWidth = 1, opacity = 1, forElevation = false, arrowLength: lineLength = 0}) => {
    const {outerRadius, cx, cy} = useGaugeState();

    if (!isFiniteNumber(angle) || !hasFiniteGaugeGeometry(cx, cy, outerRadius)) {
        return null;
    }

    const angleInRad = forElevation ?
        ((90 - angle) * Math.PI) / 180 :
        (angle * Math.PI) / 180;

    // Calculate point at the edge of the circle
    const edgePoint = {
        x: cx + outerRadius * Math.sin(angleInRad),
        y: cy - outerRadius * Math.cos(angleInRad),
    };

    // Calculate the inner point (inward from the edge)
    const innerPoint = {
        x: edgePoint.x - lineLength * Math.sin(angleInRad),
        y: edgePoint.y + lineLength * Math.cos(angleInRad),
    };

    // Calculate arrowhead points
    const arrowHeadSize = 10;
    // Angle for arrowhead lines (30 degrees from main line)
    const arrowAngle1 = angleInRad + Math.PI/6;
    const arrowAngle2 = angleInRad - Math.PI/6;

    const arrowHead1 = {
        x: edgePoint.x + arrowHeadSize * Math.sin(arrowAngle1),
        y: edgePoint.y - arrowHeadSize * Math.cos(arrowAngle1),
    };

    const arrowHead2 = {
        x: edgePoint.x + arrowHeadSize * Math.sin(arrowAngle2),
        y: edgePoint.y - arrowHeadSize * Math.cos(arrowAngle2),
    };

    // Create a path for the arrow (line with arrowhead)
    const arrowPath = `
        M ${innerPoint.x} ${innerPoint.y}
        L ${edgePoint.x} ${edgePoint.y}
        M ${edgePoint.x} ${edgePoint.y}
        L ${arrowHead1.x} ${arrowHead1.y}
        M ${edgePoint.x} ${edgePoint.y}
        L ${arrowHead2.x} ${arrowHead2.y}
    `;

    return (
        <g>
            <path
                d={arrowPath}
                stroke={stroke}
                strokeWidth={strokeWidth}
                opacity={opacity}
                fill="none"
            />
        </g>
    );
};

const Pointer = ({angle, stroke = "currentColor", strokeWidth = 1, opacity = 0.3, forElevation = false, dotted = false}) => {
    const {outerRadius, cx, cy} = useGaugeState();
    if (!isFiniteNumber(angle) || !hasFiniteGaugeGeometry(cx, cy, outerRadius)) {
        return null;
    }
    const angleInRad = forElevation ?
        ((90 - angle) * Math.PI) / 180 :
        (angle * Math.PI) / 180;
    const target = {
        x: cx + outerRadius * Math.sin(angleInRad),
        y: cy - outerRadius * Math.cos(angleInRad),
    };
    return (
        <g>
            <path
                d={`M ${cx} ${cy} L ${target.x} ${target.y}`}
                stroke={stroke}
                strokeWidth={strokeWidth}
                opacity={opacity}
                strokeDasharray={dotted ? "4,4" : "none"}
            />
        </g>
    );
};

const normalizeAngle = (angle) => {
    if (!Number.isFinite(angle)) return null;
    const normalized = angle % 360;
    return normalized < 0 ? normalized + 360 : normalized;
};

// A circular gauge has one visual position for both 0° and 360°. Keep its
// value below the upper endpoint so the gauge library never has to render its
// full-circle boundary for a north-pointing rotator.
const normalizeAzimuthForGauge = (azimuth) => normalizeAngle(azimuth);

const clockwiseDistance = (start, end) => (end - start + 360) % 360;

const isAngleOnClockwiseArcInclusive = (angle, arcStart, arcEnd, epsilon = 1e-6) => {
    const arcLength = clockwiseDistance(arcStart, arcEnd);
    const pointLength = clockwiseDistance(arcStart, angle);
    return pointLength >= -epsilon && pointLength <= arcLength + epsilon;
};

export const determineAzimuthArcFlags = (startAz, endAz, peakAz = null) => {
    const start = normalizeAngle(startAz);
    const end = normalizeAngle(endAz);
    if (start === null || end === null) {
        return [0, 1];
    }

    const cwLength = clockwiseDistance(start, end);
    const ccwLength = (360 - cwLength) % 360;

    // If no peak is available, keep behavior: prefer clockwise (sweep=1),
    // and choose large/small based on shortest/longest relationship.
    if (!Number.isFinite(peakAz)) {
        return [cwLength > 180 ? 1 : 0, 1];
    }

    const peak = normalizeAngle(peakAz);
    if (peak === null) {
        return [cwLength > 180 ? 1 : 0, 1];
    }

    const onClockwiseArc = isAngleOnClockwiseArcInclusive(peak, start, end);
    const onCounterClockwiseArc = isAngleOnClockwiseArcInclusive(peak, end, start);

    if (onClockwiseArc && !onCounterClockwiseArc) {
        return [cwLength > 180 ? 1 : 0, 1];
    }
    if (!onClockwiseArc && onCounterClockwiseArc) {
        // Counter-clockwise from start->end is clockwise from end->start.
        // For the same start/end SVG points, this maps to opposite sweep.
        return [ccwLength > 180 ? 1 : 0, 0];
    }

    // Ambiguous (e.g. peak on both boundaries) - choose the shorter path.
    if (cwLength <= ccwLength) {
        return [cwLength > 180 ? 1 : 0, 1];
    }
    return [ccwLength > 180 ? 1 : 0, 0];
};

const CircleSlice = ({
                         startAngle,
                         endAngle,
                         stroke = "currentColor",
                         fill = "currentColor",
                         strokeWidth = 1,
                         opacity = 0.2,
                         forElevation = false,
                         peakAz = null
                     }) => {
    const { outerRadius, cx, cy } = useGaugeState();
    if (
        !hasFiniteGaugeGeometry(cx, cy, outerRadius) ||
        outerRadius <= 0 ||
        !isFiniteNumber(startAngle) ||
        !isFiniteNumber(endAngle)
    ) {
        return null;
    }

    // Convert startAngle and endAngle to radians
    const startAngleRad = (startAngle * Math.PI) / 180;
    const endAngleRad = (endAngle * Math.PI) / 180;

    // Calculate the start and end points on the circle
    const start = {
        x: cx + outerRadius * Math.sin(startAngleRad),
        y: cy - outerRadius * Math.cos(startAngleRad),
    };

    const end = {
        x: cx + outerRadius * Math.sin(endAngleRad),
        y: cy - outerRadius * Math.cos(endAngleRad),
    };

    let largeArcFlag = 0;
    let sweepFlag = 1;

    if (!forElevation) {
        // Get arc flags for SVG path
        const result = determineAzimuthArcFlags(startAngle, endAngle, peakAz);
        if (result && result.length === 2) {
            [largeArcFlag, sweepFlag] = result;
        }
    } else {
        largeArcFlag = 0;
        sweepFlag = 0;
    }

    // Create the SVG path for a slice
    // M: Move to center
    // L: Line to start point
    // A: Arc from start to end point
    // Z: Close path (line back to center)
    const pathData = `
        M ${cx} ${cy}
        L ${start.x} ${start.y}
        A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}
        Z
    `;

    return (
        <g>
            <path
                d={pathData}
                stroke={stroke}
                strokeWidth={strokeWidth}
                fill={fill}
                opacity={opacity}
            />
        </g>
    );
};

const rescaleToRange = (value, originalMin, originalMax, targetMin, targetMax) => {
    if (
        !isFiniteNumber(value) ||
        !isFiniteNumber(originalMin) ||
        !isFiniteNumber(originalMax) ||
        !isFiniteNumber(targetMin) ||
        !isFiniteNumber(targetMax) ||
        originalMax === originalMin
    ) {
        return null;
    }

    // Calculate what percentage the value is in its original range
    const percentage = (value - originalMin) / (originalMax - originalMin);

    // Map that percentage to the target range
    return targetMin + percentage * (targetMax - targetMin);
};

function GaugeAz({az, limits = [null, null],
                     peakAz = null, targetCurrentAz = null,
                     isGeoStationary = false, isGeoSynchronous = false,
                     hardwareLimits = [null, null], size = 140
}) {
    let [maxAz, minAz] = limits;
    let [hwMinAz, hwMaxAz] = hardwareLimits;
    const safeAz = normalizeAzimuthForGauge(az);
    const safeTargetCurrentAz = isFiniteNumber(targetCurrentAz) ? targetCurrentAz : null;
    minAz = isFiniteNumber(minAz) ? minAz : null;
    maxAz = isFiniteNumber(maxAz) ? maxAz : null;
    hwMinAz = isFiniteNumber(hwMinAz) ? hwMinAz : null;
    hwMaxAz = isFiniteNumber(hwMaxAz) ? hwMaxAz : null;

    return (
        <GaugeContainer
            style={{
                margin: 'auto',
                touchAction: 'auto',
                pointerEvents: 'none',
            }}
            valueMin={0}
            valueMax={360}
            width={size}
            height={size}
            startAngle={0}
            endAngle={360}
            value={safeAz}
            onTouchStart={(e) => {
                // Stop event from bubbling up
                e.stopPropagation();
            }}
            onTouchMove={(e) => {
                // Stop event from bubbling up
                e.stopPropagation();
            }}
        >
            <GaugeReferenceArc/>
            <Pointer angle={270} dotted={true} stroke="#666" opacity={0.3}/>
            <Pointer angle={180} dotted={true} stroke="#666" opacity={0.3}/>
            <Pointer angle={90} dotted={true} stroke="#666" opacity={0.3}/>
            <Pointer angle={0} dotted={true} stroke="#666" opacity={0.3}/>
            {/* Pass limits - green allowed zone */}
            {minAz !== null && maxAz !== null && (!isGeoStationary && !isGeoSynchronous) && <>
                <Pointer angle={maxAz} stroke="#888" strokeWidth={1} opacity={0.3}/>
                <Pointer angle={minAz} stroke="#888" strokeWidth={1} opacity={0.3}/>
                <CircleSlice
                    startAngle={minAz}
                    endAngle={maxAz}
                    peakAz={peakAz}
                    stroke='#4caf50'
                    fill='#4caf50'
                    opacity={0.2}
                />
            </>}
            <text x={size * 0.5} y={size * 0.129} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.086} fontWeight={"bold"}>0</text>
            <text x={size * 0.886} y={size * 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.086} fontWeight={"bold"}>90</text>
            <text x={size * 0.5} y={size * 0.893} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.086} fontWeight={"bold"}>180</text>
            <text x={size * 0.107} y={size * 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.086} fontWeight={"bold"}>270</text>
            {/* Hardware limits - red restricted zones */}
            {hwMinAz !== null && hwMaxAz !== null && <>
                {/* Show red zone from 0 to hwMinAz if hwMinAz > 0 */}
                {hwMinAz > 0 && <CircleSlice
                    startAngle={0}
                    endAngle={hwMinAz}
                    stroke='#f44336'
                    fill='#f44336'
                    opacity={0.3}
                />}
                {/* Show red zone from hwMaxAz to 360 if hwMaxAz < 360 */}
                {hwMaxAz < 360 && <CircleSlice
                    startAngle={hwMaxAz}
                    endAngle={360}
                    stroke='#f44336'
                    fill='#f44336'
                    opacity={0.3}
                />}
            </>}
            {/* Keep current-position indicators visible even in a restricted sector. */}
            <EdgeArrow angle={safeTargetCurrentAz} />
            <GaugePointer/>
        </GaugeContainer>
    );
}

function GaugeEl({el, maxElevation = null, targetCurrentEl = null, hardwareLimits = [null, null], size = 130}) {
    const safeEl = isFiniteNumber(el) ? el : null;
    const safeMaxElevation = isFiniteNumber(maxElevation) ? maxElevation : null;
    const safeTargetCurrentEl = isFiniteNumber(targetCurrentEl) ? targetCurrentEl : null;
    let [hwMinEl, hwMaxEl] = hardwareLimits;
    hwMinEl = isFiniteNumber(hwMinEl) ? hwMinEl : null;
    hwMaxEl = isFiniteNumber(hwMaxEl) ? hwMaxEl : null;
    const angle = safeMaxElevation !== null ? rescaleToRange(safeMaxElevation, 0, 90, 90, 0) : null;

    const rescaleValue = (value) => {
        return 90 - value;
    };

    // Convert hardware limits to gauge angles (elevation gauge is inverted)
    const hwMinElAngle = hwMinEl !== null ? rescaleToRange(hwMinEl, 0, 90, 90, 0) : null;
    const hwMaxElAngle = hwMaxEl !== null ? rescaleToRange(hwMaxEl, 0, 90, 90, 0) : null;

    return (
        <GaugeContainer
            style={{
                margin: 'auto',
                touchAction: 'auto',
                pointerEvents: 'none',
            }}
            valueMin={90}
            valueMax={0}
            width={size}
            height={size}
            startAngle={0}
            endAngle={90}
            value={safeEl}
            onTouchStart={(e) => {
                // Stop event from bubbling up
                e.stopPropagation();
            }}
            onTouchMove={(e) => {
                // Stop event from bubbling up
                e.stopPropagation();
            }}
        >
            <GaugeReferenceArc/>
            <Pointer angle={0} dotted={true} stroke="#666" opacity={0.3}/>
            <Pointer angle={90} dotted={true} stroke="#666" opacity={0.3}/>
            {/* Pass limits - green allowed zone */}
            {safeMaxElevation !== null && hwMinElAngle !== null && <>
                <Pointer angle={angle} stroke="#888" strokeWidth={1} opacity={0.3}/>
                <CircleSlice
                    startAngle={hwMinElAngle}
                    endAngle={angle}
                    stroke='#4caf50'
                    fill='#4caf50'
                    opacity={0.2}
                    forElevation={true}
                    spansNorth={false}
                />
            </>}
            <text x={size * 0.823} y={size * 0.923} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.092} fontWeight={"bold"}>0</text>
            <text x={size * 0.615} y={size * 0.423} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.092} fontWeight={"bold"}>45</text>
            <text x={size * 0.077} y={size * 0.177} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.092} fontWeight={"bold"}>90</text>
            {/* Hardware limits - red restricted zones */}
            {hwMinElAngle !== null && hwMaxElAngle !== null && <>
                {/* Show red zone from gauge angle 90 (0° elevation) to hwMinElAngle */}
                <CircleSlice
                    startAngle={90}
                    endAngle={hwMinElAngle}
                    stroke='#f44336'
                    fill='#f44336'
                    forElevation={true}
                    opacity={0.3}
                />
                {/* Show red zone from hwMaxElAngle to 0 (90° elevation) if maxel < 90 */}
                {hwMaxEl < 90 && <CircleSlice
                    startAngle={hwMaxElAngle}
                    endAngle={0}
                    stroke='#f44336'
                    fill='#f44336'
                    forElevation={true}
                    opacity={0.3}
                />}
            </>}
            {/* Elevation endpoints can also fall inside a restricted sector. */}
            <EdgeArrow angle={safeTargetCurrentEl !== null ? rescaleValue(safeTargetCurrentEl) : null} />
            <GaugePointer/>
        </GaugeContainer>
    );
}

export { GaugePointer, EdgeArrow, Pointer, CircleSlice, GaugeAz, GaugeEl, normalizeAzimuthForGauge, rescaleToRange };
