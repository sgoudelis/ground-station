/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

const ACTIVITY_BINS = 320;

export function packetActivityRanges(positions, start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
    if (start === end) {
        return positions.some((point) => Date.parse(point.captured_at) === start) ? [{start, end}] : [];
    }

    // Group packets at the slider's display resolution, preserving empty gaps
    // without creating one SVG element per packet in large captures.
    const bins = new Uint8Array(ACTIVITY_BINS);
    const duration = end - start;
    for (const point of positions) {
        const time = Date.parse(point.captured_at);
        if (!Number.isFinite(time) || time < start || time > end) continue;
        const index = Math.min(ACTIVITY_BINS - 1, Math.floor((time - start) / duration * ACTIVITY_BINS));
        bins[index] = 1;
    }

    const ranges = [];
    let first = null;
    for (let index = 0; index <= ACTIVITY_BINS; index += 1) {
        if (bins[index] && first === null) first = index;
        if (!bins[index] && first !== null) {
            ranges.push({start: start + first / ACTIVITY_BINS * duration, end: start + index / ACTIVITY_BINS * duration});
            first = null;
        }
    }
    return ranges;
}
