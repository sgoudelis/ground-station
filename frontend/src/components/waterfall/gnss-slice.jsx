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

import { createSlice } from '@reduxjs/toolkit';

const FIX_QUALITY_TIMELINE_WINDOW_MS = 30 * 60 * 1000;
const FIX_QUALITY_TIMELINE_MAX_POINTS = 4000;
const FIX_QUALITY_TIMELINE_MIN_APPEND_MS = 15 * 1000;
const GNSS_SATELLITE_EVENT_HISTORY_MAX = 40;

export function getVerifiedGnssSatellites(satellitesById) {
    return Object.values(satellitesById || {}).filter((satellite) => Number.isFinite(satellite.verifiedAtMs));
}

export function getVerifiedGnssSatelliteCountForStream(satellitesById, lifecycle, sessionId, vfo) {
    if (!lifecycle || !streamMatchesLifecycle(lifecycle, sessionId, vfo)) return 0;
    // The marker and decoded table must count the same persisted verification evidence.
    return getVerifiedGnssSatellites(satellitesById).length;
}

const CONSTELLATION_BY_CODE = {
    G: 'GPS',
    E: 'GALILEO',
    R: 'GLONASS',
    C: 'BEIDOU',
    B: 'BEIDOU',
    J: 'QZSS',
};

function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeConstellation(value) {
    if (!value) return '';
    const raw = String(value).trim();
    const upper = raw.toUpperCase();
    if (CONSTELLATION_BY_CODE[upper]) {
        return CONSTELLATION_BY_CODE[upper];
    }
    if (upper === 'GALILEO' || upper === 'GLONASS' || upper === 'BEIDOU' || upper === 'GPS' || upper === 'QZSS') {
        return upper;
    }
    return raw;
}

function parsePrnValue(value) {
    if (value === null || value === undefined) return null;
    const match = String(value).toUpperCase().match(/(\d{1,3})/);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}

function extractChannel(output) {
    if (output?.channel !== undefined && output?.channel !== null) {
        const parsed = Number(output.channel);
        return Number.isFinite(parsed) ? parsed : null;
    }
    const message = String(output?.message || '');
    const match = message.match(/channel\s+(\d+)/i);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}

function extractSatelliteIdentity(output) {
    if (!output) return null;

    const code = String(output.satellite_system || '').trim().toUpperCase();
    const prnFromFields = parsePrnValue(output.satellite_prn);
    if (code && Number.isFinite(prnFromFields)) {
        return {
            constellation: normalizeConstellation(code),
            prn: prnFromFields,
        };
    }

    const satelliteText = String(output.satellite || '');
    const prnNameMatch = satelliteText.match(/([A-Za-z]+)\s+PRN\s+([A-Za-z]?\d+)/i);
    if (prnNameMatch) {
        const parsedPrn = parsePrnValue(prnNameMatch[2]);
        if (!Number.isFinite(parsedPrn)) {
            return null;
        }
        return {
            constellation: normalizeConstellation(prnNameMatch[1]),
            prn: parsedPrn,
        };
    }

    const message = String(output.message || '');
    const acqMatch = message.match(/for satellite\s+([A-Z])\s+(\d+)/i);
    if (acqMatch) {
        return {
            constellation: normalizeConstellation(acqMatch[1]),
            prn: parsePrnValue(acqMatch[2]),
        };
    }

    const trackingMatch = message.match(/for satellite\s+([A-Za-z]+)\s+PRN\s+([A-Za-z]?\d+)/i);
    if (trackingMatch) {
        const parsedPrn = parsePrnValue(trackingMatch[2]);
        if (!Number.isFinite(parsedPrn)) {
            return null;
        }
        return {
            constellation: normalizeConstellation(trackingMatch[1]),
            prn: parsedPrn,
        };
    }

    return null;
}

function getStateForEvent(eventType, message, fallbackState = 'detected') {
    const normalizedMessage = String(message || '').toLowerCase();
    if (eventType === 'acquisition') return 'acquired';
    if (eventType === 'lost') return 'lost';
    if (eventType === 'tracking' || eventType === 'nmea' || eventType === 'nmea_gga' || eventType === 'nmea_rmc') {
        return 'tracking';
    }
    if (normalizedMessage.includes('loss of lock')) return 'lost';
    if (normalizedMessage.includes('idle state')) return 'idle';
    return fallbackState;
}

function getGnssFixStatusFromOutput(output) {
    const normalizedOutput = output || {};
    const eventType = String(normalizedOutput.event || '').toLowerCase();

    // Heartbeat traffic is transport telemetry, not fix-evidence.
    if (eventType === 'gnss_activity') {
        return null;
    }

    const backendFixStatus = String(normalizedOutput.gnss_fix_status || '').trim().toUpperCase();
    if (backendFixStatus === 'FIX' || backendFixStatus === 'NO FIX') {
        // Prefer backend-derived state when available so fix acquire/loss semantics stay centralized.
        return backendFixStatus;
    }

    const latitude = toFiniteNumber(normalizedOutput.latitude);
    const longitude = toFiniteNumber(normalizedOutput.longitude);
    const hasCoords = latitude !== null && longitude !== null;
    const hasPvtField = normalizedOutput.has_pvt !== undefined && normalizedOutput.has_pvt !== null;
    const hasPvt = hasPvtField ? Boolean(normalizedOutput.has_pvt) : null;
    const hasFixQualityField = normalizedOutput.fix_quality !== undefined
        && normalizedOutput.fix_quality !== null
        && String(normalizedOutput.fix_quality).trim() !== '';
    const hasFixQuality = hasFixQualityField && String(normalizedOutput.fix_quality).trim() !== '0';
    const isNmea = eventType === 'nmea' || eventType === 'nmea_gga' || eventType === 'nmea_rmc';
    const isFixSignal = hasCoords || hasFixQualityField || hasPvtField || isNmea;

    if (!isFixSignal) {
        return null;
    }
    // A no-fix quality value takes precedence over coordinates from an older fix.
    if (hasFixQualityField && !hasFixQuality) {
        return 'NO FIX';
    }
    return (hasCoords || hasFixQuality || hasPvt) ? 'FIX' : 'NO FIX';
}

function streamMatchesLifecycle(lifecycle, sessionId, vfo) {
    const hasActiveStream = lifecycle.activeSessionId !== null || lifecycle.activeVfo !== null;
    if (!hasActiveStream) {
        return true;
    }
    return String(sessionId ?? '') === String(lifecycle.activeSessionId ?? '')
        && String(vfo ?? '') === String(lifecycle.activeVfo ?? '');
}

const initialState = {
    decodedInsightsActiveTab: 'packets',
    gnssSatellitesSortModel: [{ field: 'satelliteId', sort: 'asc' }],
    // Runtime GNSS summary snapshot. Keep this outside decoders.outputs ring-buffer so
    // table/status-bar churn cannot blank summary fields when old outputs are trimmed.
    receiverSnapshot: {
        lastUpdateMs: null,
        latitude: null,
        longitude: null,
        altitudeM: null,
        fixQuality: null,
        satellites: null,
        utcTime: null,
    },
    activitySnapshot: {
        lastHeartbeatMs: null,
        hasActivity: false,
        hasPvt: false,
        packetsPerSec: 0,
        monitorObsPerSec: 0,
        lossOfLockTotal: 0,
        lossOfLockDelta: 0,
    },
    // Runtime GNSS lifecycle for the decoded island summary.
    gnssFixLifecycle: {
        currentStatus: 'NO DATA',
        currentFixStartedAtMs: null,
        lastFixAcquiredAtMs: null,
        lastClosedFixAcquiredAtMs: null,
        lastFixLostAtMs: null,
        lastFixDurationMs: null,
        lastSignalAtMs: null,
        decoderStartedAtMs: null,
        noFixSinceAtMs: null,
        activeSessionId: null,
        activeVfo: null,
        activeDecoderId: null,
    },
    // UI-only rolling fix quality samples for the last 30 minutes.
    gnssFixQualityTimeline: [],
    // Runtime per-satellite GNSS cache keyed by "<CONSTELLATION>-<PRN>".
    // Keeps Doppler/CN0/time visible independently of decoders.outputs ring-buffer trimming.
    gnssSatellitesById: {},
};

export const gnssSlice = createSlice({
    name: 'gnssState',
    initialState,
    reducers: {
        setDecodedInsightsActiveTab: (state, action) => {
            state.decodedInsightsActiveTab = ['gnss', 'adsb'].includes(action.payload) ? action.payload : 'packets';
        },
        setGnssSatellitesSortModel: (state, action) => {
            state.gnssSatellitesSortModel = action.payload;
        },
        clearGnssInsightsHistory: (state) => {
            // Clear displayed GNSS history without interrupting the active receiver/fix lifecycle.
            state.gnssSatellitesById = {};
            state.gnssFixQualityTimeline = [];
        },
        resetGnssFixLifecycle: (state) => {
            // Reset live GNSS runtime state for a fresh streaming/decoder session.
            state.receiverSnapshot = {
                lastUpdateMs: null,
                latitude: null,
                longitude: null,
                altitudeM: null,
                fixQuality: null,
                satellites: null,
                utcTime: null,
            };
            state.activitySnapshot = {
                lastHeartbeatMs: null,
                hasActivity: false,
                hasPvt: false,
                packetsPerSec: 0,
                monitorObsPerSec: 0,
                lossOfLockTotal: 0,
                lossOfLockDelta: 0,
            };
            state.gnssFixLifecycle = {
                currentStatus: 'NO DATA',
                currentFixStartedAtMs: null,
                lastFixAcquiredAtMs: null,
                lastClosedFixAcquiredAtMs: null,
                lastFixLostAtMs: null,
                lastFixDurationMs: null,
                lastSignalAtMs: null,
                decoderStartedAtMs: null,
                noFixSinceAtMs: null,
                activeSessionId: null,
                activeVfo: null,
                activeDecoderId: null,
            };
            state.gnssFixQualityTimeline = [];
            state.gnssSatellitesById = {};
        },
        updateGnssFixLifecycleFromStatus: (state, action) => {
            const payload = action.payload || {};
            if (payload.decoder_type !== 'gnss') {
                return;
            }

            const status = String(payload.status || '').toLowerCase();
            const timestampMs = Number(payload.timestamp) * 1000;
            const hasTimestamp = Number.isFinite(timestampMs);
            const lifecycle = state.gnssFixLifecycle;

            if (status === 'starting') {
                // A fresh GNSS decoder instance owns lifecycle timing from this point.
                state.receiverSnapshot = {
                    lastUpdateMs: null,
                    latitude: null,
                    longitude: null,
                    altitudeM: null,
                    fixQuality: null,
                    satellites: null,
                    utcTime: null,
                };
                state.activitySnapshot = {
                    lastHeartbeatMs: null,
                    hasActivity: false,
                    hasPvt: false,
                    packetsPerSec: 0,
                    monitorObsPerSec: 0,
                    lossOfLockTotal: 0,
                    lossOfLockDelta: 0,
                };
                state.gnssFixQualityTimeline = [];
                state.gnssSatellitesById = {};

                state.gnssFixLifecycle = {
                    currentStatus: 'NO DATA',
                    currentFixStartedAtMs: null,
                    lastFixAcquiredAtMs: null,
                    lastClosedFixAcquiredAtMs: null,
                    lastFixLostAtMs: null,
                    lastFixDurationMs: null,
                    lastSignalAtMs: null,
                    decoderStartedAtMs: hasTimestamp ? timestampMs : null,
                    noFixSinceAtMs: hasTimestamp ? timestampMs : null,
                    activeSessionId: payload.session_id ?? null,
                    activeVfo: payload.vfo ?? null,
                    activeDecoderId: payload.decoder_id ?? null,
                };
                return;
            }

            if (!streamMatchesLifecycle(lifecycle, payload.session_id, payload.vfo)) {
                return;
            }

            if (status === 'idle' || status === 'error' || status === 'closed') {
                lifecycle.currentStatus = 'NO DATA';
                lifecycle.currentFixStartedAtMs = null;
                lifecycle.decoderStartedAtMs = null;
                lifecycle.noFixSinceAtMs = null;
                lifecycle.activeSessionId = null;
                lifecycle.activeVfo = null;
                lifecycle.activeDecoderId = null;
                return;
            }

            // Reconnect/resubscribe fallback: if a GNSS decoder is already running and the
            // UI missed the explicit "starting" status, bootstrap ownership/timer from the
            // first non-terminal status we do receive (e.g., listening/tracking).
            if (
                status
                && lifecycle.activeSessionId === null
                && lifecycle.activeVfo === null
            ) {
                lifecycle.activeSessionId = payload.session_id ?? null;
                lifecycle.activeVfo = payload.vfo ?? null;
                lifecycle.activeDecoderId = payload.decoder_id ?? null;

                if (hasTimestamp) {
                    lifecycle.decoderStartedAtMs = timestampMs;
                    if (lifecycle.currentStatus !== 'FIX' && lifecycle.noFixSinceAtMs === null) {
                        lifecycle.noFixSinceAtMs = timestampMs;
                    }
                }
                return;
            }

            // Keep decoder identity fresh for the active stream.
            if (
                payload.decoder_id !== undefined
                && streamMatchesLifecycle(lifecycle, payload.session_id, payload.vfo)
            ) {
                lifecycle.activeDecoderId = payload.decoder_id;
            }
        },
        updateGnssFixLifecycleFromOutput: (state, action) => {
            const payload = action.payload || {};
            if (payload.decoder_type !== 'gnss') {
                return;
            }

            const timestampMs = Number(payload.timestamp) * 1000;
            if (!Number.isFinite(timestampMs)) {
                return;
            }

            const output = payload.output || {};
            const eventType = String(output.event || '').toLowerCase();
            const lifecycle = state.gnssFixLifecycle;

            if (!streamMatchesLifecycle(lifecycle, payload.session_id, payload.vfo)) {
                return;
            }

            if (eventType === 'gnss_activity') {
                const activity = state.activitySnapshot;
                activity.lastHeartbeatMs = timestampMs;
                activity.hasActivity = Boolean(output.has_activity);
                activity.hasPvt = Boolean(output.has_pvt);
                activity.packetsPerSec = toFiniteNumber(output.udp_packets_per_sec) || 0;
                activity.monitorObsPerSec = toFiniteNumber(output.monitor_observations_per_sec) || 0;
                activity.lossOfLockTotal = toFiniteNumber(output.loss_of_lock_total) || 0;
                activity.lossOfLockDelta = toFiniteNumber(output.loss_of_lock_delta) || 0;
                return;
            }

            const latitude = toFiniteNumber(output.latitude);
            const longitude = toFiniteNumber(output.longitude);
            const altitudeM = toFiniteNumber(output.altitude_m);
            const satellites = toFiniteNumber(output.satellites);
            const hasFixQualityField = output.fix_quality !== undefined
                && output.fix_quality !== null
                && String(output.fix_quality).trim() !== '';
            const fixQualityValue = hasFixQualityField ? String(output.fix_quality).trim() : null;
            const cn0DbHz = toFiniteNumber(output.cn0_db_hz);
            const carrierDopplerHz = toFiniteNumber(output.carrier_doppler_hz);
            const matchedNorad = toFiniteNumber(output.satellite_norad_id);
            const matchedName = String(output.satellite_name || '').trim();
            const utcTime = typeof output.utc_time === 'string' && output.utc_time.trim()
                ? output.utc_time.trim()
                : null;
            const isNmea = eventType === 'nmea' || eventType === 'nmea_gga' || eventType === 'nmea_rmc';
            const eventTypeLabel = eventType || 'event';
            const message = String(output.message || '');

            const identity = extractSatelliteIdentity(output);
            if (identity && identity.constellation && Number.isFinite(identity.prn)) {
                const id = `${identity.constellation}-${identity.prn}`;
                if (!state.gnssSatellitesById[id]) {
                    state.gnssSatellitesById[id] = {
                        id,
                        satelliteId: `${identity.constellation} ${String(identity.prn).padStart(2, '0')}`,
                        constellation: identity.constellation,
                        prn: identity.prn,
                        state: 'detected',
                        eventCount: 0,
                        acquisitionCount: 0,
                        trackingCount: 0,
                        nmeaCount: 0,
                        lostCount: 0,
                        firstSeen: timestampMs,
                        lastSeen: timestampMs,
                        lastChannel: null,
                        lastEvent: eventTypeLabel,
                        lastMessage: '-',
                        verifiedAtMs: null,
                        verificationSource: null,
                        lastCn0DbHz: null,
                        lastCarrierDopplerHz: null,
                        lastUtcTime: null,
                        latitude: null,
                        longitude: null,
                        altitudeM: null,
                        fixQuality: null,
                        matchedNorad: null,
                        matchedName: '-',
                        events: [],
                    };
                }

                const row = state.gnssSatellitesById[id];
                const channel = extractChannel(output);
                const eventState = getStateForEvent(eventTypeLabel, message, row.state);

                row.eventCount += 1;
                row.firstSeen = Math.min(row.firstSeen, timestampMs);
                row.lastSeen = Math.max(row.lastSeen, timestampMs);
                row.lastChannel = channel ?? row.lastChannel;
                row.lastEvent = eventTypeLabel;
                row.lastMessage = message || row.lastMessage;
                row.state = eventState;
                if (output.navigation_verified === true && row.verifiedAtMs === null) {
                    // Keep proof of reception after a later loss of lock.
                    row.verifiedAtMs = timestampMs;
                    row.verificationSource = String(output.verification_source || 'navigation_data');
                }

                if (eventTypeLabel === 'acquisition') row.acquisitionCount += 1;
                if (eventTypeLabel === 'tracking') row.trackingCount += 1;
                if (eventTypeLabel === 'lost') row.lostCount += 1;
                if (isNmea) row.nmeaCount += 1;

                if (latitude !== null) row.latitude = latitude;
                if (longitude !== null) row.longitude = longitude;
                if (altitudeM !== null) row.altitudeM = altitudeM;
                if (fixQualityValue !== null) row.fixQuality = fixQualityValue;
                if (matchedNorad !== null) row.matchedNorad = matchedNorad;
                if (matchedName) row.matchedName = matchedName;
                if (cn0DbHz !== null) row.lastCn0DbHz = cn0DbHz;
                if (carrierDopplerHz !== null) row.lastCarrierDopplerHz = carrierDopplerHz;
                if (utcTime !== null) row.lastUtcTime = utcTime;

                row.events.unshift({
                    timestampMs,
                    eventType: eventTypeLabel,
                    state: eventState,
                    channel,
                    message: message || '-',
                    cn0DbHz,
                    carrierDopplerHz,
                    utcTime,
                });
                if (row.events.length > GNSS_SATELLITE_EVENT_HISTORY_MAX) {
                    row.events = row.events.slice(0, GNSS_SATELLITE_EVENT_HISTORY_MAX);
                }
            }

            const receiver = state.receiverSnapshot;
            if (latitude !== null) receiver.latitude = latitude;
            if (longitude !== null) receiver.longitude = longitude;
            if (altitudeM !== null) receiver.altitudeM = altitudeM;
            if (satellites !== null) receiver.satellites = satellites;
            if (fixQualityValue !== null) {
                receiver.fixQuality = fixQualityValue;
            }
            if (utcTime !== null) {
                receiver.utcTime = utcTime;
            }

            if (
                isNmea
                || latitude !== null
                || longitude !== null
                || altitudeM !== null
                || satellites !== null
                || hasFixQualityField
                || utcTime !== null
            ) {
                receiver.lastUpdateMs = timestampMs;
            }

            const derivedStatus = getGnssFixStatusFromOutput(output);

            // Track a compact rolling timeline for UI diagnostics.
            if (hasFixQualityField) {
                const qualityValue = toFiniteNumber(fixQualityValue);
                if (qualityValue !== null) {
                    const timeline = state.gnssFixQualityTimeline;
                    const lastPoint = timeline.length > 0 ? timeline[timeline.length - 1] : null;
                    if (
                        !lastPoint
                        || lastPoint.quality !== qualityValue
                        || (timestampMs - lastPoint.timestampMs) >= FIX_QUALITY_TIMELINE_MIN_APPEND_MS
                    ) {
                        timeline.push({
                            timestampMs,
                            quality: qualityValue,
                        });
                    }

                    const cutoffMs = timestampMs - FIX_QUALITY_TIMELINE_WINDOW_MS;
                    while (timeline.length > 0 && timeline[0].timestampMs < cutoffMs) {
                        timeline.shift();
                    }
                    if (timeline.length > FIX_QUALITY_TIMELINE_MAX_POINTS) {
                        timeline.splice(0, timeline.length - FIX_QUALITY_TIMELINE_MAX_POINTS);
                    }
                }
            }

            if (!derivedStatus) {
                return;
            }

            lifecycle.lastSignalAtMs = timestampMs;

            if (derivedStatus === lifecycle.currentStatus) {
                if (
                    derivedStatus === 'NO FIX'
                    && lifecycle.noFixSinceAtMs === null
                    && lifecycle.decoderStartedAtMs !== null
                ) {
                    lifecycle.noFixSinceAtMs = timestampMs;
                }
                return;
            }

            if (derivedStatus === 'FIX') {
                lifecycle.currentStatus = 'FIX';
                lifecycle.currentFixStartedAtMs = timestampMs;
                lifecycle.lastFixAcquiredAtMs = timestampMs;
                lifecycle.noFixSinceAtMs = null;
                return;
            }

            const wasFix = lifecycle.currentStatus === 'FIX';
            if (wasFix && lifecycle.currentFixStartedAtMs !== null) {
                lifecycle.lastClosedFixAcquiredAtMs = lifecycle.currentFixStartedAtMs;
                lifecycle.lastFixDurationMs = Math.max(0, timestampMs - lifecycle.currentFixStartedAtMs);
            }
            lifecycle.currentStatus = 'NO FIX';
            lifecycle.currentFixStartedAtMs = null;
            lifecycle.lastFixLostAtMs = timestampMs;
            if (
                wasFix
                || (lifecycle.noFixSinceAtMs === null && lifecycle.decoderStartedAtMs !== null)
            ) {
                lifecycle.noFixSinceAtMs = timestampMs;
            }
        },
    },
});

export const {
    setDecodedInsightsActiveTab,
    setGnssSatellitesSortModel,
    clearGnssInsightsHistory,
    resetGnssFixLifecycle,
    updateGnssFixLifecycleFromStatus,
    updateGnssFixLifecycleFromOutput,
} = gnssSlice.actions;

export default gnssSlice.reducer;
