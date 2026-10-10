import i18n from '../../i18n/config';

/**
 * Module-level translator.
 *
 * These helpers run outside React (redux thunks and socket acknowledgement
 * callbacks), where the `useTranslation` hook is unavailable. Bind a fixed-namespace
 * translator to the shared i18n instance instead (same approach as
 * waterfall/vfo-marker/vfo-config.js).
 */
const t = i18n.getFixedT(null, 'target');

// Commands and hardware observations have separate lifecycles. A request ACK
// only confirms acceptance and can arrive after the worker's terminal event.
export const COMMAND_BUSY = ['sending', 'submitted', 'started', 'unknown'];
export const COMMAND_TERMINAL = ['succeeded', 'failed', 'cancelled'];

export const isCommandOutstanding = command => Boolean(
    command && COMMAND_BUSY.includes(command.status) && !command.reconciled
);

export const isCommandSpinning = command => isCommandOutstanding(command) && command.status !== 'unknown';

export function isCommandActionPending(command, scope, state) {
    return isCommandSpinning(command) && (
        command.requestedState?.[`${scope}State`] === state
        || (state === 'stopped' && command.action === 'stop')
    );
}

export function normalizeCommand(value) {
    return {
        ...value,
        commandId: value.command_id ?? value.commandId,
        trackerId: value.tracker_id ?? value.trackerId,
        scopes: value.scopes || (value.scope === 'tracking' ? ['rotator', 'rig', 'target'] : [value.scope]),
        requestedState: value.requested_state ? {
            rotatorState: value.requested_state.rotator_state,
            rigState: value.requested_state.rig_state,
        } : value.requestedState,
        submittedAt: value.submitted_at ? value.submitted_at * 1000 : value.submittedAt || Date.now(),
        updatedAt: value.updated_at ? value.updated_at * 1000 : value.updatedAt || Date.now(),
    };
}

export function mergeCommand(state, value) {
    const incoming = normalizeCommand(value);
    if (!incoming.commandId || !incoming.trackerId) return;
    const current = state.trackerCommandsById[incoming.commandId];
    // Order local sending states and server records on the browser's clock.
    // In particular, a new Stop must win before its acknowledgement arrives.
    incoming.submittedAt = current?.submittedAt ?? (incoming.submittedAt
        - (value.submitted_at ? state.trackerServerOffset || 0 : 0));
    // Completion feedback expires on the browser's clock, including results
    // restored from the server journal after reconnecting.
    if (value.updated_at) incoming.updatedAt -= state.trackerServerOffset || 0;
    if (current) {
        if (COMMAND_TERMINAL.includes(current.status)) return;
        if (incoming.revision && current.revision && (incoming.revision < current.revision || (incoming.revision === current.revision && current.status !== 'unknown'))) return;
        // Local uncertainty may be resolved by a newer authoritative snapshot.
        if (!incoming.revision && current.revision && incoming.status !== 'unknown') return;
        if (incoming.status === 'submitted' && current.status === 'started') return;
    }
    state.trackerCommandsById[incoming.commandId] = {...current, ...incoming};
}

export function selectTrackerCommand(commands, trackerId, scope, deviceId) {
    let selected = null;
    for (const command of Object.values(commands || {})) {
        if (command.trackerId !== trackerId && !(deviceId && command.device_ids?.[scope] === deviceId)) continue;
        if (scope && !command.scopes?.includes(scope)) continue;
        const priority = Number(isCommandOutstanding(command)) - Number(isCommandOutstanding(selected));
        if (!selected || priority > 0 || (priority === 0 && (command.submittedAt || 0) > (selected.submittedAt || 0))) {
            selected = command;
        }
    }
    return selected;
}

export function pruneCommandHistory(state) {
    const commands = Object.values(state.trackerCommandsById);
    if (commands.length <= 500) return;
    const completed = commands
        .filter(command => !isCommandOutstanding(command))
        .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
    // Retain all unsettled work and the latest 500 outcomes. Recent terminal
    // records also stay through the ACK window to reject delayed acceptance.
    const cutoff = Date.now() - 30000;
    for (const command of completed.slice(500)) {
        if ((command.updatedAt || 0) < cutoff) delete state.trackerCommandsById[command.commandId];
    }
}

export function commandPatch(data, current = {}) {
    const fields = ['norad_id', 'target_type', 'target_key', 'target_name', 'mission_id', 'command', 'body_id',
        'rotator_state', 'rig_state', 'group_id', 'rig_id', 'rotator_id', 'transmitter_id', 'rig_vfo', 'vfo1', 'vfo2'];
    return Object.fromEntries(fields.filter(key => data[key] !== undefined && data[key] !== current[key])
        .map(key => [key, data[key]]));
}

export function commandScopes(changes, action) {
    const scopes = [];
    if (action === 'move' || (action === 'stop' && !Object.keys(changes).length) || ['rotator_state', 'rotator_id'].some(key => key in changes)) scopes.push('rotator');
    if (['rig_state', 'rig_id', 'transmitter_id', 'rig_vfo', 'vfo1', 'vfo2'].some(key => key in changes)) scopes.push('rig');
    if (Object.keys(changes).some(key => !['rotator_state', 'rotator_id', 'rig_state', 'rig_id', 'transmitter_id', 'rig_vfo', 'vfo1', 'vfo2'].includes(key))) scopes.push('target');
    return scopes.length ? scopes : ['target'];
}

export function commandLabel(command) {
    if (!command) return '';
    if (command.status === 'unknown' && command.action === 'stop') return command.reason || 'Physical Stop unconfirmed; tracking updates paused';
    if (command.status === 'unknown') return command.reconciled
        ? 'Previous outcome unconfirmed; current hardware state restored'
        : 'Status unknown — checking connection';
    if (command.status === 'sending') return 'Sending…';
    if (command.status === 'submitted') return 'Queued…';
    if (command.status === 'started') return ({move: 'Moving…', stop: 'Stopping…', park: 'Parking…',
        connect: 'Connecting…', disconnect: 'Disconnecting…', track: 'Starting tracking…'})[command.action] || 'Applying changes…';
    if (command.status === 'failed') return command.reason || 'Command failed';
    if (command.status === 'cancelled') return command.reason || 'Command cancelled';
    if (command.status === 'succeeded' && command.action === 'stop') return 'Stopped';
    return command.reason || ({move: 'Position reached', stop: 'Stopped', park: 'Parked'})[command.action] || 'Command completed';
}

export function callTrackerApi(socket, cmd, data, timeout = 8000) {
    return new Promise((resolve, reject) => {
        if (!socket?.connected) {
            reject({message: t('tracker_command_state.not_connected_to_backend', { defaultValue: 'Not connected to backend' }), uncertain: false});
            return;
        }
        // Do not buffer hardware actions for automatic transmission after reconnect.
        socket.timeout(timeout).emit('api.call', {cmd, data}, (error, response) => {
            if (error) reject({message: t('tracker_command_state.acknowledgement_missing_checking_command_status', { defaultValue: 'Acknowledgement missing; checking command status' }), uncertain: true});
            else if (!response?.success) reject({message: response?.message || response?.error || 'Command rejected', uncertain: false});
            else resolve(response.data);
        });
    });
}
