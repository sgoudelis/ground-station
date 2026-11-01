/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

const earthRadius = 6371000;
const fiveDegrees = 5 * Math.PI / 180;

export function getCircleBounds([latitude, longitude], radius) {
    const radians = Math.PI / 180;
    const latitudeRadians = latitude * radians;
    const angularRadius = radius / earthRadius;
    const south = Math.max(-Math.PI / 2, latitudeRadians - angularRadius);
    const north = Math.min(Math.PI / 2, latitudeRadians + angularRadius);
    const longitudeRadius = south <= -Math.PI / 2 || north >= Math.PI / 2 ? Math.PI
        : Math.asin(Math.min(1, Math.sin(angularRadius) / Math.cos(latitudeRadians)));
    // Keep longitudes unwrapped so a circle crossing the date line stays local.
    return [[south / radians, longitude - longitudeRadius / radians],
        [north / radians, longitude + longitudeRadius / radians]];
}

export function getHorizonRadii(altitude) {
    if (!Number.isFinite(altitude) || altitude <= 0) return null;

    // Ground distances on a spherical Earth, assuming a sea-level observer.
    // At elevation e, the central angle is acos(R cos(e) / (R + h)) - e.
    const ratio = earthRadius / (earthRadius + altitude);
    return {
        horizon: earthRadius * Math.acos(ratio),
        fiveDegrees: earthRadius * Math.max(0, Math.acos(ratio * Math.cos(fiveDegrees)) - fiveDegrees),
    };
}
