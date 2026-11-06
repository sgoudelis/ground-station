import {canControlRotator} from './rotator-utils.js';
import {ROTATOR_STATES} from './tracking-constants.js';

const finiteOrNull = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

// Keep manual limits and interlocks identical in the tracking page and top bar.
export function getManualRotatorState({rotator, rotatorData = {}, trackingState = {}, confirmedTrackingState = {}, hardwareReady}) {
    const minAz = finiteOrNull(rotatorData.minaz) ?? finiteOrNull(rotator?.minaz) ?? 0;
    const configuredMaxAz = finiteOrNull(rotatorData.maxaz) ?? finiteOrNull(rotator?.maxaz) ?? 360;
    const currentAz = finiteOrNull(rotatorData.az);
    const overlappingAzimuth = rotator?.azimuth_mode === '0_450';
    const parked = trackingState.rotator_state === ROTATOR_STATES.PARKED || Boolean(rotatorData.parked);

    return {
        minAz,
        // The extra 360–450° overlap lane is for automatic tracking only.
        maxAz: overlappingAzimuth ? Math.min(configuredMaxAz, 360) : configuredMaxAz,
        minEl: finiteOrNull(rotatorData.minel) ?? finiteOrNull(rotator?.minel) ?? 0,
        maxEl: finiteOrNull(rotatorData.maxel) ?? finiteOrNull(rotator?.maxel) ?? 90,
        // Show the physical bearing on the conventional manual 0–360° dial.
        currentAz: currentAz === null || !overlappingAzimuth ? currentAz : ((currentAz % 360) + 360) % 360,
        currentEl: rotatorData.el,
        disabled: !hardwareReady || !canControlRotator(rotatorData, confirmedTrackingState)
            || trackingState.rotator_state === ROTATOR_STATES.TRACKING || parked,
        disabledReason: rotatorData.motion_unconfirmed ? 'Waiting for stationary position readings'
            : parked ? 'Unpark the rotator before using manual control'
                : 'Connect the rotator and stop automatic tracking first',
    };
}

export function canStopManualRotator({hasTargets = true, connected, command, busy, isStopPending, rotatorData = {}}) {
    const retryStop = command?.action === 'stop' && ['failed', 'unknown'].includes(command.status);
    // Stop can supersede movement and remains available when its outcome is uncertain.
    return hasTargets && connected && !isStopPending && (busy || (
        rotatorData.connected && (rotatorData.motion_unconfirmed || retryStop || rotatorData.tracking
            || rotatorData.slewing || rotatorData.park_requested)
    ));
}
