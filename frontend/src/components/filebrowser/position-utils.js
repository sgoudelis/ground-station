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
