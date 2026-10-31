/**
 * Helpers for turning an incoming `audio-data` payload into Web Audio samples.
 *
 * The backend sends little-endian float32 PCM as a Socket.IO binary attachment,
 * which arrives as an ArrayBuffer (or a typed-array view in some runtimes).
 * A plain JSON number array is still accepted for older backends.
 */

/**
 * Convert the `samples` field of an audio-data payload into a Float32Array.
 * Returns null when the payload cannot be interpreted.
 *
 * @param {ArrayBuffer|ArrayBufferView|number[]|null|undefined} samples
 * @returns {Float32Array|null}
 */
export const toFloat32Samples = (samples) => {
    if (!samples) return null;
    if (samples instanceof Float32Array) return samples;
    if (samples instanceof ArrayBuffer) {
        if (samples.byteLength % 4 !== 0) return null;
        return new Float32Array(samples);
    }
    if (ArrayBuffer.isView(samples)) {
        const { buffer, byteOffset, byteLength } = samples;
        if (byteLength % 4 !== 0) return null;
        // Float32Array views must be 4-byte aligned; copy when the view isn't.
        if (byteOffset % 4 === 0) {
            return new Float32Array(buffer, byteOffset, byteLength / 4);
        }
        return new Float32Array(buffer.slice(byteOffset, byteOffset + byteLength));
    }
    if (Array.isArray(samples)) return Float32Array.from(samples);
    return null;
};

/**
 * Clamp samples to [-1, 1] in place and return their RMS level (0..1).
 *
 * @param {Float32Array} samples
 * @returns {number}
 */
export const clampAndMeasureRms = (samples) => {
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
        let v = samples[i];
        if (v > 1) v = 1;
        else if (v < -1) v = -1;
        else if (v !== v) v = 0; // NaN guard
        samples[i] = v;
        sumSquares += v * v;
    }
    return samples.length ? Math.sqrt(sumSquares / samples.length) : 0;
};
