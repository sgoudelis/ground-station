import { beginSDRConfigRequest, finishSDRConfigRequest, updateSDRConfig } from './waterfall-slice.jsx';

// Monotonic across accordion remounts; the socket ID scopes it to one connection.
let sequence = 0;

export async function configureSdr({ socket, store, settings, call }) {
    const sdrId = settings.selectedSDRId;
    const request = { origin: socket?.id || 'disconnected', sequence: ++sequence };
    store.dispatch(beginSDRConfigRequest({ sdrId, request }));
    let response;
    try {
        response = await call({ ...settings, configRequest: request.sequence });
    } catch (error) {
        response = { success: false, error: error?.message || String(error) };
    }
    // Completing an older call must not clear the newest request's protection.
    const current = store.getState().waterfall.sdrConfigRequestsById[sdrId];
    const latest = current?.origin === request.origin && current.sequence === request.sequence;
    store.dispatch(finishSDRConfigRequest({ sdrId, request, success: Boolean(response?.success) }));
    if (latest && response?.data?.config && store.getState().waterfall.selectedSDRId === sdrId) {
        store.dispatch(updateSDRConfig({ ...response.data.config, force_live: !response.success }));
    }
    return { ...response, superseded: !latest || Boolean(response?.data?.superseded) };
}
