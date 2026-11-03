import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, render, renderHook, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import '../../../i18n/config.js';
import { setupTheme } from '../../../theme.js';
import waterfallReducer from '../waterfall-slice.jsx';
import vfoReducer from '../vfo-marker/vfo-slice.jsx';
import decodersReducer from '../../decoders/decoders-slice.jsx';
import SdrAccordion from '../settings-sdr.jsx';

vi.mock('../background-stream-control.jsx', () => ({ default: () => null }));
import useWaterfallStream from '../waterfall-stream.jsx';
import { toast } from '../../../utils/toast-with-timestamp.jsx';

const socket = {
    id: 'dashboard-socket',
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
    emit: vi.fn((_event, request, callback) => {
        if (typeof callback !== 'function') return;
        callback(request.cmd === 'sdr.start-streaming'
            ? { success: false, error: 'Airspy serial 0000000000001234: AIRSPY_ERROR_NOT_FOUND (code -5)' }
            : { success: true });
    }),
};

vi.mock('../../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('../waterfall-engine-provider.jsx', () => ({
    useWaterfallEngine: () => ({ subscribeToFftData: () => () => {} }),
}));
vi.mock('../use-sdr-takeover-dialog.jsx', () => ({
    useSdrTakeoverDialog: () => ({ requestTakeoverConfirmation: vi.fn(), takeoverDialog: null }),
}));
vi.mock('../../../utils/toast-with-timestamp.jsx', () => ({ toast: { error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

const createStore = (overrides = {}) => {
    const initialWaterfall = waterfallReducer(undefined, { type: '@@INIT' });
    return configureStore({
        reducer: { waterfall: waterfallReducer, vfo: vfoReducer, decoders: decodersReducer },
        preloadedState: {
            waterfall: {
                ...initialWaterfall,
                selectedSDRId: 'sdr-a',
                gain: 10,
                sampleRate: 2_500_000,
                sampleRateValues: [2_500_000],
                selectedAntenna: 'RX',
                antennasList: { rx: ['RX'], tx: [] },
                ...overrides,
            },
        },
    });
};

test.each(['original-socket', 'adopted-session'])(
    'Stop detaches %s with background receiving enabled and leaves recordings running',
    async (receivingSessionId) => {
        const captureSnapshot = vi.fn();
        vi.stubGlobal('captureWaterfallSnapshot', captureSnapshot);
        const store = createStore({
            isStreaming: true,
            backgroundStreaming: true,
            receivingSessionId,
            isRecording: true,
        });
        const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
        const { result } = renderHook(() => useWaterfallStream({}), { wrapper });

        await act(async () => result.current.stopStreaming());

        // Only detach is requested; the stream and recorders must stay alive.
        expect(socket.emit.mock.calls.map(([, request]) => request.cmd)).toEqual(['sdr.detach-streaming']);
        expect(captureSnapshot).not.toHaveBeenCalled();
        expect(socket.disconnect).not.toHaveBeenCalled();
        expect(socket.connect).not.toHaveBeenCalled();
        expect(store.getState().waterfall).toMatchObject({
            isStreaming: false,
            receivingSessionId: null,
            backgroundStreaming: false,
            isRecording: false,
        });
        expect(store.getState().decoders.currentSessionId).toBe('dashboard-socket');
    }
);

test('Stop waits for detach acknowledgement and keeps reception active on failure', async () => {
    let acknowledge;
    socket.emit.mockImplementationOnce((_event, _request, callback) => { acknowledge = callback; });
    const store = createStore({ isStreaming: true, isRecording: true, backgroundStreaming: true });
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { result } = renderHook(() => useWaterfallStream({}), { wrapper });

    let stopping;
    act(() => { stopping = result.current.stopStreaming(); });
    expect(store.getState().waterfall.isStreaming).toBe(true);
    await act(async () => {
        acknowledge({ success: false, error: 'Could not release control' });
        await stopping;
    });

    expect(store.getState().waterfall).toMatchObject({ isStreaming: true, isRecording: true, backgroundStreaming: true });
    expect(toast.error).toHaveBeenCalledWith('Could not release control');
    expect(socket.disconnect).not.toHaveBeenCalled();
});

test('Stop with background receiving disabled finalizes the recording and stops the stream', async () => {
    const store = createStore({ isStreaming: true, isRecording: true, backgroundStreaming: false });
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { result } = renderHook(() => useWaterfallStream({}), { wrapper });

    await act(async () => result.current.stopStreaming());

    expect(socket.emit.mock.calls.map(([, request]) => request.cmd)).toEqual([
        'sdr.stop-recording', 'sdr.stop-streaming',
    ]);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.connect).not.toHaveBeenCalled();
    expect(store.getState().waterfall.isStreaming).toBe(false);
});

test('Stop leaves a joined stream without disconnecting the tab', async () => {
    const store = createStore({ isStreaming: true, joinedSdrId: 'sdr-a' });
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { result } = renderHook(() => useWaterfallStream({}), { wrapper });

    await act(async () => result.current.stopStreaming());

    expect(socket.emit.mock.calls.map(([, request]) => request.cmd)).toEqual(['sdr.leave-sdr']);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.connect).not.toHaveBeenCalled();
    expect(store.getState().waterfall).toMatchObject({ isStreaming: false, joinedSdrId: null });
});

test('shows the detailed startup command error in one dialog', async () => {
    const store = createStore();
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { result } = renderHook(() => useWaterfallStream({}), { wrapper });

    await act(async () => result.current.startStreaming());

    expect(socket.emit.mock.calls.filter(([event]) => event === 'api.call').map(([, request]) => request.cmd)).toEqual([
        'sdr.configure-sdr', 'sdr.start-streaming',
    ]);
    expect(store.getState().waterfall.errorMessage).toBe(
        'Airspy serial 0000000000001234: AIRSPY_ERROR_NOT_FOUND (code -5)'
    );
    expect(store.getState().waterfall.errorDialogOpen).toBe(true);
});

test('uses the receiving identity returned by configuration before starting consumers', async () => {
    socket.emit.mockImplementationOnce((_event, _request, callback) => callback({
        success: true, data: { session_id: 'receiving:independent' },
    }));
    const store = createStore();
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { result } = renderHook(() => useWaterfallStream({}), { wrapper });

    await act(async () => result.current.startStreaming());

    expect(store.getState().waterfall.receivingSessionId).toBe('receiving:independent');
    expect(store.getState().decoders.currentSessionId).toBe('receiving:independent');
});

test.each([
    ['unset', 'none', [2_500_000]],
    ['stale', 2_500_000, [2_048_000]],
])('blocks an %s sample rate and opens the error dialog', async (_case, sampleRate, sampleRateValues) => {
    const store = createStore({ sampleRate, sampleRateValues, expandedPanels: [] });
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { result } = renderHook(() => useWaterfallStream({}), { wrapper });

    await act(async () => result.current.startStreaming());

    expect(socket.emit.mock.calls.filter(([event]) => event === 'api.call')).toEqual([]);
    expect(store.getState().waterfall.startStreamValidationErrors).toEqual({
        sdr: false,
        gain: false,
        sampleRate: true,
        antenna: false,
    });
    expect(store.getState().waterfall.expandedPanels).toContain('sdr');
    expect(store.getState().waterfall.errorDialogOpen).toBe(true);
    expect(store.getState().waterfall.errorMessage).toBe('Select sample rate before starting stream');
});

test('lists each missing SDR setting in the validation dialog', async () => {
    const store = createStore({ gain: 'none', sampleRate: 'none', selectedAntenna: 'none' });
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { result } = renderHook(() => useWaterfallStream({}), { wrapper });

    await act(async () => result.current.startStreaming());

    expect(socket.emit.mock.calls.filter(([event]) => event === 'api.call')).toEqual([]);
    expect(store.getState().waterfall.startStreamValidationErrors).toEqual({
        sdr: false,
        gain: true,
        sampleRate: true,
        antenna: true,
    });
    expect(store.getState().waterfall.errorMessage).toBe([
        'Select gain before starting stream',
        'Select sample rate before starting stream',
        'Select antenna before starting stream',
    ].join('\n'));
});

test('keeps Play enabled with no SDR and explains the missing selection in a dialog', async () => {
    const store = createStore({
        selectedSDRId: 'none',
        expandedPanels: [],
        startStreamValidationErrors: { sdr: false, gain: true, sampleRate: true, antenna: true },
    });
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { result } = renderHook(() => useWaterfallStream({}), { wrapper });

    expect(result.current.playButtonEnabledOrNot()).toBe(false);
    await act(async () => result.current.startStreaming());

    expect(socket.emit.mock.calls.filter(([event]) => event === 'api.call')).toEqual([]);
    expect(store.getState().waterfall.expandedPanels).toContain('sdr');
    expect(store.getState().waterfall.startStreamValidationErrors).toEqual({
        sdr: true,
        gain: false,
        sampleRate: false,
        antenna: false,
    });
    expect(store.getState().waterfall.errorDialogOpen).toBe(true);
    expect(store.getState().waterfall.errorMessage).toBe('Select an SDR before starting stream');
});

test.each([
    ['unset', 'none', ['RX']],
    ['stale', 'OLD', ['RX']],
])('blocks an %s antenna and opens the error dialog', async (_case, selectedAntenna, rx) => {
    const store = createStore({ selectedAntenna, antennasList: { rx, tx: [] }, expandedPanels: [] });
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { result } = renderHook(() => useWaterfallStream({}), { wrapper });

    await act(async () => result.current.startStreaming());

    expect(socket.emit.mock.calls.filter(([event]) => event === 'api.call')).toEqual([]);
    expect(store.getState().waterfall.startStreamValidationErrors).toEqual({
        sdr: false,
        gain: false,
        sampleRate: false,
        antenna: true,
    });
    expect(store.getState().waterfall.expandedPanels).toContain('sdr');
    expect(store.getState().waterfall.errorDialogOpen).toBe(true);
    expect(store.getState().waterfall.errorMessage).toBe('Select antenna before starting stream');
});

test('highlights the SDR selector when Play is clicked without a device', () => {
    render(<ThemeProvider theme={setupTheme()}><SdrAccordion
        expanded
        sdrs={[{ id: 'sdr-a', name: 'SDR A', type: 'rtlsdrusbv4' }]}
        selectedSDRId="none"
        gainValues={[]}
        sampleRateValues={[]}
        antennasList={{ rx: [], tx: [] }}
        sdrSettings={{}}
        startStreamValidationErrors={{ sdr: true }}
    /></ThemeProvider>);

    const sdrLabel = screen.getAllByText('SDR').find((element) => element.tagName === 'LABEL');
    expect(sdrLabel).toHaveClass('Mui-error');
    expect(screen.getByText('Select an SDR before starting stream')).toBeInTheDocument();
});

test('highlights the sample rate and antenna menus when start validation fails', () => {
    render(<ThemeProvider theme={setupTheme()}><SdrAccordion
        expanded
        sdrs={[{ id: 'sdr-a', name: 'SDR A', type: 'rtlsdrusbv4' }]}
        selectedSDRId="sdr-a"
        gainValues={[]}
        localGain={10}
        sampleRateValues={[2_048_000]}
        localSampleRate={2_500_000}
        antennasList={{ rx: ['RX'], tx: [] }}
        selectedAntenna="OLD"
        sdrSettings={{}}
        startStreamValidationErrors={{ sampleRate: true, antenna: true }}
    /></ThemeProvider>);

    const rateLabel = screen.getAllByText('Sample Rate').find((element) => element.tagName === 'LABEL');
    const antennaLabel = screen.getAllByText('Antenna').find((element) => element.tagName === 'LABEL');
    expect(rateLabel).toHaveClass('Mui-error');
    expect(antennaLabel).toHaveClass('Mui-error');
    expect(screen.getByText('Select sample rate before starting stream')).toBeInTheDocument();
    expect(screen.getByText('Select antenna before starting stream')).toBeInTheDocument();
});
