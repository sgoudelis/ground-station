import { configureStore } from '@reduxjs/toolkit';
import reducer, { setCenterFrequency, updateSDRConfig } from '../waterfall-slice.jsx';
import { configureSdr } from '../sdr-config.js';

const config = (frequency, revision, request) => ({
    sdr_id: 'radio', center_freq: frequency, config_epoch: 'worker',
    config_revision: revision, ...(request && { config_request: request }),
});

function setup() {
    const initial = reducer(undefined, { type: '@@INIT' });
    const store = configureStore({ reducer: { waterfall: reducer }, preloadedState: {
        waterfall: { ...initial, selectedSDRId: 'radio' },
    } });
    store.dispatch(updateSDRConfig(config(145e6, 0)));
    const calls = [];
    function tune(frequency) {
        store.dispatch(setCenterFrequency(frequency));
        const promise = configureSdr({
            socket: { id: 'browser' }, store,
            settings: { selectedSDRId: 'radio', centerFrequency: frequency },
            call: (payload) => new Promise((resolve) => calls.push({ payload, resolve })),
        });
        return promise;
    }
    const echo = (index, frequency, revision) => config(frequency, revision, {
        origin: 'browser', sequence: calls[index].payload.configRequest,
    });
    return { store, tune, calls, echo, frequency: () => store.getState().waterfall.centerFrequency };
}

test('rapid tuning stays at the latest value through delayed and out-of-order echoes', async () => {
    const { store, tune, calls, echo, frequency } = setup();
    const first = tune(146e6);
    const second = tune(147e6);
    store.dispatch(updateSDRConfig(echo(0, 146e6, 1)));
    expect(frequency()).toBe(147e6);
    calls[0].resolve({ success: true, data: { config: echo(0, 146e6, 1) } });
    expect((await first).superseded).toBe(true);
    expect(store.getState().waterfall.sdrConfigRequestsById.radio.pending).toBe(true);
    store.dispatch(updateSDRConfig(echo(1, 147e6, 2)));
    calls[1].resolve({ success: true, data: { config: echo(1, 147e6, 2) } });
    await second;
    store.dispatch(updateSDRConfig(echo(0, 146e6, 1)));
    expect(frequency()).toBe(147e6);
});

test('failed latest tuning restores the last accepted frequency without clearing a newer request', async () => {
    const { store, tune, calls, echo, frequency } = setup();
    const first = tune(146e6);
    store.dispatch(updateSDRConfig(echo(0, 146e6, 1)));
    const second = tune(147e6);
    calls[0].resolve({ success: false });
    await first;
    expect(frequency()).toBe(147e6);
    calls[1].resolve({ success: false, data: { config: echo(0, 146e6, 1) } });
    await second;
    expect(frequency()).toBe(146e6);
    expect(store.getState().waterfall.sdrConfigRequestsById.radio.pending).toBe(false);
});

test('joined viewers and another controller follow newer authoritative revisions', async () => {
    const { store, tune, calls, echo, frequency } = setup();
    store.dispatch(updateSDRConfig(config(150e6, 1, { origin: 'other', sequence: 12 })));
    expect(frequency()).toBe(150e6);
    const pending = tune(151e6);
    store.dispatch(updateSDRConfig(config(152e6, 3, { origin: 'other', sequence: 13 })));
    calls[0].resolve({ success: true, data: { config: echo(0, 151e6, 2) } });
    await pending;
    expect(frequency()).toBe(152e6);
    // A replacement worker starts a fresh revision space.
    store.dispatch(updateSDRConfig({ ...config(153e6, 0), config_epoch: 'replacement', force_live: true }));
    expect(frequency()).toBe(153e6);
});

test('hardware failure reconciliation wins over an acceptance reply still in flight', async () => {
    const { store, tune, calls, echo, frequency } = setup();
    const pending = tune(146e6);
    store.dispatch(updateSDRConfig(echo(0, 146e6, 1)));
    store.dispatch(updateSDRConfig(echo(0, 145e6, 2)));
    calls[0].resolve({ success: true, data: { config: echo(0, 146e6, 1) } });
    await pending;
    expect(frequency()).toBe(145e6);
});

test('transport rejection releases the pending tune and restores confirmed frequency', async () => {
    const { store, frequency } = setup();
    store.dispatch(setCenterFrequency(146e6));
    const response = await configureSdr({
        socket: { id: 'browser' }, store, settings: { selectedSDRId: 'radio' },
        call: () => Promise.reject(new Error('Disconnected')),
    });
    expect(response.success).toBe(false);
    expect(frequency()).toBe(145e6);
});

test('measured hardware status does not overwrite requested frequency', () => {
    const { store, frequency } = setup();
    store.dispatch(setCenterFrequency(146e6));
    store.dispatch(updateSDRConfig({ sdr_id: 'radio', receiver_status: { frequency_hz: 145e6 } }));
    expect(frequency()).toBe(146e6);
});
