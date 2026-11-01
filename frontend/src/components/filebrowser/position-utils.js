/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function isValidMapPosition(latitude, longitude) {
    // Missing coordinates must not become a plausible position through Number(null).
    return Number.isFinite(latitude) && Math.abs(latitude) <= 90
        && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
}

export function toLocationNumber(value) {
    // Station settings can contain numeric strings, but empty fields are unknown.
    if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function getReceiverDistances(position, receiver) {
    const latitude = position?.latitude;
    const longitude = position?.longitude;
    const receiverLatitude = toLocationNumber(receiver?.lat);
    const receiverLongitude = toLocationNumber(receiver?.lon);
    if (!isValidMapPosition(latitude, longitude)
        || !isValidMapPosition(receiverLatitude, receiverLongitude)) return null;

    const radians = Math.PI / 180;
    const earthRadiusKm = 6371.0088;
    // Clamp the haversine to keep roundoff near antipodal points within [0, 1].
    const haversine = Math.min(1, Math.max(0,
        Math.sin((latitude - receiverLatitude) * radians / 2) ** 2
        + Math.cos(latitude * radians) * Math.cos(receiverLatitude * radians)
        * Math.sin((longitude - receiverLongitude) * radians / 2) ** 2,
    ));
    const groundKm = 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
    const altitude = toLocationNumber(position?.altitude);
    const receiverAltitude = toLocationNumber(receiver?.alt);
    let slantKm = null;
    if (altitude !== null && receiverAltitude !== null) {
        const targetRadius = earthRadiusKm + altitude / 1000;
        const receiverRadius = earthRadiusKm + receiverAltitude / 1000;
        // A spherical-Earth chord includes curvature and remains stable overhead.
        const chord = Math.hypot((altitude - receiverAltitude) / 1000,
            2 * Math.sqrt(targetRadius * receiverRadius * haversine));
        if (targetRadius > 0 && receiverRadius > 0 && Number.isFinite(chord)) slantKm = chord;
    }
    return {groundKm, slantKm};
}
