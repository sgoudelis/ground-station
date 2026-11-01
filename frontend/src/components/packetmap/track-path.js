/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

const samplesPerSegment = 8;

const extrapolate = (point, neighbor) => point.map((value, axis) => 2 * value - neighbor[axis]);
const interpolate = (left, right, start, end, time) => left.map((value, axis) =>
    ((end - time) * value + (time - start) * right[axis]) / (end - start));
const interval = (left, right) => Math.sqrt(Math.hypot(right[0] - left[0], right[1] - left[1]));

export function smoothTrackSegments(coordinates) {
    // Repeated fixes have no distance between knots and would divide by zero.
    const points = coordinates.filter((point, index) => index === 0
        || point[0] !== coordinates[index - 1][0] || point[1] !== coordinates[index - 1][1]);
    const segments = [];
    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const path = [start];
        const previous = points[index - 1] || extrapolate(start, end);
        const next = points[index + 2] || extrapolate(end, start);
        // Keep longitude discontinuities as received instead of inventing
        // intermediate fixes across the other side of the world.
        if (points.length < 3 || Math.abs(previous[1] - start[1]) > 180 || Math.abs(start[1] - end[1]) > 180
            || Math.abs(end[1] - next[1]) > 180) {
            segments.push([start, end]);
            continue;
        }

        // Centripetal Catmull–Rom follows every fix and handles uneven spacing
        // without the loops that uniform spline interpolation can introduce.
        const t0 = 0;
        const t1 = interval(previous, start);
        const t2 = t1 + interval(start, end);
        const t3 = t2 + interval(end, next);
        for (let sample = 1; sample < samplesPerSegment; sample += 1) {
            const time = t1 + (t2 - t1) * sample / samplesPerSegment;
            const a = interpolate(previous, start, t0, t1, time);
            const b = interpolate(start, end, t1, t2, time);
            const c = interpolate(end, next, t2, t3, time);
            const left = interpolate(a, b, t0, t2, time);
            const right = interpolate(b, c, t1, t3, time);
            path.push(interpolate(left, right, t1, t2, time));
        }
        // Retain exact coordinates for the original fixes and both endpoints.
        path.push(end);
        segments.push(path);
    }
    // Retain stationary intervals for playback. They share a curve knot but
    // still have distinct timestamps, so the transmitter must pause there.
    let segmentIndex = 0;
    return coordinates.slice(1).map((end, index) => {
        const start = coordinates[index];
        return start[0] === end[0] && start[1] === end[1] ? [start, end] : segments[segmentIndex++];
    });
}

export function smoothTrack(coordinates) {
    if (!coordinates.length) return [];
    return [coordinates[0], ...smoothTrackSegments(coordinates).flatMap((segment) => segment.slice(1))]
        .filter((point, index, path) => index === 0 || point[0] !== path[index - 1][0] || point[1] !== path[index - 1][1]);
}
