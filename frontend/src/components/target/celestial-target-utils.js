const MAX_TARGET_PASS_HOURS = 24;
const TARGET_SLOT_ID_PATTERN = /^target-(\d+)$/;

export const normalizeTargetType = (trackingState = {}) => {
    const explicitType = String(trackingState?.target_type || '').trim().toLowerCase();
    if (explicitType === 'satellite' || explicitType === 'mission' || explicitType === 'body') {
        return explicitType;
    }
    if (String(trackingState?.mission_id || '').trim()) return 'mission';
    if (String(trackingState?.command || '').trim()) return 'mission';
    if (String(trackingState?.body_id || '').trim()) return 'body';
    return 'satellite';
};

const normalizeText = (value) => String(value ?? '').trim();

const normalizeBodyId = (value) => normalizeText(value).toLowerCase();

const normalizeMissionId = (value) => normalizeText(value);

export const parseTargetSlotNumber = (trackerId = '') => {
    const match = String(trackerId || '').trim().match(TARGET_SLOT_ID_PATTERN);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const formatBodyNameFromId = (bodyId) => {
    const normalizedBodyId = normalizeBodyId(bodyId);
    if (!normalizedBodyId) return '';
    return normalizedBodyId
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};

const buildTargetKey = ({ targetType, missionId, command, bodyId }) => {
    if (targetType === 'mission') {
        if (missionId) {
            return `mission:${missionId}`;
        }
        // Preserve the legacy command-scoped key for mission rows that do not expose mission_id.
        return command ? `missioncmd:${command}` : '';
    }
    if (targetType === 'body') {
        return bodyId ? `body:${bodyId}` : '';
    }
    return '';
};

export const buildTargetKeyFromCelestialRow = (row = {}) => {
    const explicitKey = normalizeText(row?.target_key || row?.targetKey);
    if (explicitKey) {
        return explicitKey;
    }

    const explicitType = String(row?.target_type || row?.targetType || '').trim().toLowerCase();
    if (explicitType === 'body') {
        const bodyId = normalizeBodyId(row?.body_id || row?.bodyId || row?.command);
        return bodyId ? `body:${bodyId}` : '';
    }
    if (explicitType === 'mission') {
        const missionId = normalizeMissionId(row?.mission_id || row?.missionId);
        if (missionId) {
            return `mission:${missionId}`;
        }
        const command = normalizeText(row?.command);
        return command ? `missioncmd:${command}` : '';
    }
    if (explicitType === 'satellite') {
        return '';
    }

    // Fallback for partially populated rows where target_type is missing.
    const fallbackBodyId = normalizeBodyId(row?.body_id || row?.bodyId);
    if (fallbackBodyId) {
        return `body:${fallbackBodyId}`;
    }
    const fallbackMissionId = normalizeMissionId(row?.mission_id || row?.missionId);
    if (fallbackMissionId) {
        return `mission:${fallbackMissionId}`;
    }
    const fallbackCommand = normalizeText(row?.command);
    return fallbackCommand ? `missioncmd:${fallbackCommand}` : '';
};

const isIdentifierOnlyName = ({ name, targetType, missionId, command, bodyId }) => {
    const normalizedName = normalizeText(name).toLowerCase();
    if (!normalizedName) return true;
    if (targetType === 'mission') {
        const normalizedMissionId = normalizeMissionId(missionId).toLowerCase();
        if (normalizedMissionId && normalizedName === normalizedMissionId) {
            return true;
        }
        const normalizedCommand = normalizeText(command).toLowerCase();
        return Boolean(normalizedCommand) && normalizedName === normalizedCommand;
    }
    if (targetType === 'body') {
        const normalizedBodyId = normalizeBodyId(bodyId);
        return Boolean(normalizedBodyId) && normalizedName === normalizedBodyId;
    }
    return false;
};

const resolveNameFromRows = ({ rows = [], targetType, missionId, command, bodyId, targetKey }) => {
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const normalizedKey = normalizeText(targetKey);
    const normalizedMissionId = normalizeMissionId(missionId).toLowerCase();
    const normalizedCommand = normalizeText(command).toLowerCase();
    const normalizedBodyId = normalizeBodyId(bodyId);

    const keyMatch = normalizedRows.find((row) => normalizeText(row?.target_key || row?.targetKey) === normalizedKey);
    if (keyMatch) {
        const keyName = normalizeText(keyMatch?.name || keyMatch?.displayName || keyMatch?.display_name || keyMatch?.target_name);
        if (keyName) return keyName;
    }

    if (targetType === 'mission' && normalizedMissionId) {
        const missionById = normalizedRows.find(
            (row) => normalizeMissionId(row?.mission_id || row?.missionId).toLowerCase() === normalizedMissionId
        );
        const missionIdName = normalizeText(
            missionById?.name || missionById?.displayName || missionById?.display_name || missionById?.target_name
        );
        if (missionIdName) return missionIdName;
    }

    if (targetType === 'mission' && normalizedCommand) {
        const missionMatch = normalizedRows.find(
            (row) => normalizeText(row?.command).toLowerCase() === normalizedCommand
        );
        const missionName = normalizeText(
            missionMatch?.name || missionMatch?.displayName || missionMatch?.display_name || missionMatch?.target_name
        );
        if (missionName) return missionName;
    }

    if (targetType === 'body' && normalizedBodyId) {
        const bodyMatch = normalizedRows.find((row) => {
            const rowBodyId = normalizeBodyId(row?.body_id || row?.bodyId || row?.command);
            return rowBodyId === normalizedBodyId;
        });
        const bodyName = normalizeText(
            bodyMatch?.name || bodyMatch?.displayName || bodyMatch?.display_name || bodyMatch?.target_name
        );
        if (bodyName) return bodyName;
    }

    return '';
};

export const resolveTargetIdentifier = (trackingState = {}) => {
    const targetType = normalizeTargetType(trackingState);
    if (targetType === 'mission') return normalizeMissionId(trackingState?.mission_id) || normalizeText(trackingState?.command);
    if (targetType === 'body') return normalizeBodyId(trackingState?.body_id);
    return normalizeText(trackingState?.norad_id);
};

export const resolveTargetDisplayName = ({
    trackingState = {},
    satelliteDetails = {},
    monitoredRows = [],
    celestialRows = [],
} = {}) => {
    const targetType = normalizeTargetType(trackingState);
    const missionId = normalizeMissionId(trackingState?.mission_id);
    const command = normalizeText(trackingState?.command);
    const bodyId = normalizeBodyId(trackingState?.body_id);
    const targetKey = buildTargetKey({ targetType, missionId, command, bodyId });

    const candidates = [
        normalizeText(trackingState?.target_name),
        normalizeText(satelliteDetails?.name),
        resolveNameFromRows({ rows: celestialRows, targetType, missionId, command, bodyId, targetKey }),
        resolveNameFromRows({ rows: monitoredRows, targetType, missionId, command, bodyId, targetKey }),
    ].filter(Boolean);

    const preferredName = candidates.find(
        (name) => !isIdentifierOnlyName({ name, targetType, missionId, command, bodyId })
    );
    if (preferredName) return preferredName;

    if (candidates.length > 0) return candidates[0];

    if (targetType === 'mission') return command ? `Mission ${command}` : 'Mission';
    if (targetType === 'body') return formatBodyNameFromId(bodyId) || bodyId || 'Body';
    return normalizeText(trackingState?.norad_id);
};

export const clampTargetPassHours = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return MAX_TARGET_PASS_HOURS;
    }
    return Math.min(MAX_TARGET_PASS_HOURS, parsed);
};

export const buildTargetKeyFromTrackingState = (trackingState = {}) => {
    const targetType = normalizeTargetType(trackingState);
    if (targetType === 'mission' || targetType === 'body') {
        return buildTargetKeyFromCelestialRow({
            target_type: targetType,
            mission_id: trackingState?.mission_id,
            command: trackingState?.command,
            body_id: trackingState?.body_id,
            target_key: trackingState?.target_key,
            targetKey: trackingState?.targetKey,
        });
    }
    return '';
};

export const buildTargetSlotNumberByTargetKey = (trackerInstances = []) => {
    const mapping = {};
    const instances = Array.isArray(trackerInstances) ? trackerInstances : [];

    // One target can be temporarily attached to multiple slots (e.g. race during retarget).
    // Use the lowest slot number to keep the UI deterministic.
    instances.forEach((instance) => {
        const slotNumber = parseTargetSlotNumber(instance?.tracker_id);
        if (slotNumber == null) {
            return;
        }

        const targetKey = buildTargetKeyFromTrackingState(instance?.tracking_state || {});
        if (!targetKey) {
            return;
        }

        if (mapping[targetKey] == null || slotNumber < mapping[targetKey]) {
            mapping[targetKey] = slotNumber;
        }
    });

    return mapping;
};

export const buildTargetCelestialPayload = ({
    trackingState = {},
    targetName = '',
    nextPassesHours = MAX_TARGET_PASS_HOURS,
} = {}) => {
    const targetType = normalizeTargetType(trackingState);
    if (targetType === 'satellite') {
        return null;
    }

    const futureHours = clampTargetPassHours(nextPassesHours);
    const sharedPayload = {
        past_hours: 0,
        future_hours: futureHours,
        step_minutes: 60,
    };

    if (targetType === 'mission') {
        const command = String(trackingState?.command || '').trim();
        if (!command) return null;
        return {
            ...sharedPayload,
            celestial: [
                {
                    target_type: 'mission',
                    command,
                    name: String(targetName || command).trim() || command,
                },
            ],
        };
    }

    const bodyId = String(trackingState?.body_id || '').trim().toLowerCase();
    if (!bodyId) return null;
    return {
        ...sharedPayload,
        celestial: [
            {
                target_type: 'body',
                body_id: bodyId,
                name: String(targetName || bodyId).trim() || bodyId,
            },
        ],
    };
};

export const filterPassesForTargetWindow = ({
    passes = [],
    targetKey = '',
    nextPassesHours = MAX_TARGET_PASS_HOURS,
    nowMs = Date.now(),
} = {}) => {
    const key = String(targetKey || '').trim();
    if (!key) return [];
    const source = Array.isArray(passes) ? passes : [];
    const windowEndMs = nowMs + (clampTargetPassHours(nextPassesHours) * 3600 * 1000);

    return source
        .filter((pass) => String(pass?.target_key || '').trim() === key)
        .filter((pass) => {
            const startMs = new Date(pass?.event_start || '').getTime();
            const endMs = new Date(pass?.event_end || '').getTime();
            if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
            if (endMs < nowMs) return false;
            return startMs <= windowEndMs;
        })
        .sort((left, right) => new Date(left.event_start).getTime() - new Date(right.event_start).getTime());
};
