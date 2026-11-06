import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TargetSelectorBar from './target-selector-bar.jsx';

const { socket, toastError } = vi.hoisted(() => ({
    socket: { emit: vi.fn() },
    toastError: vi.fn(),
}));

vi.mock('../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('./satellite-search.jsx', () => ({ default: () => null }));
vi.mock('./use-target-rotator-selection-dialog.jsx', () => ({
    useTargetRotatorSelectionDialog: () => ({ requestRotatorForTarget: vi.fn(), dialog: null }),
}));
vi.mock('../../utils/toast-with-timestamp.jsx', () => ({ toast: { error: toastError } }));
vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal()),
    useTranslation: () => ({ t: (key, options) => options?.defaultValue || key }),
}));

const searchCalls = () => socket.emit.mock.calls.filter(([, request]) => request.cmd === 'get-satellite-search');
const advance = (milliseconds = 300) => act(() => vi.advanceTimersByTime(milliseconds));
const option = (id) => ({ norad_id: id, name: `STARLINK-${id}` });

const openDialog = () => {
    const state = {
        targetSatTrack: { trackingState: {}, trackerId: '', trackerViews: {} },
        trackerInstances: { instances: [] },
        scheduler: { observations: [] },
        rigs: { rigs: [] },
        rotators: { rotators: [] },
        celestialMonitored: { monitored: [] },
    };
    const store = configureStore({ reducer: (current = state) => current });
    const view = render(<Provider store={store}><TargetSelectorBar /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /Add target slot/i }));
    const input = screen.getByRole('combobox', { name: 'Satellite Target' });
    fireEvent.focus(input);
    return { ...view, input };
};

describe('Add New Target satellite search', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        toastError.mockReset();
        socket.emit.mockReset().mockImplementation((_event, request, acknowledge) => {
            if (request.cmd !== 'get-satellite-search') acknowledge?.({ success: true, data: [] });
        });
    });

    afterEach(() => vi.useRealTimers());

    it('debounces typing and sends only the final query with a result limit', () => {
        const { input } = openDialog();
        for (const value of ['sta', 'star', 'starl', 'starlink']) {
            fireEvent.change(input, { target: { value } });
            advance(100);
        }
        expect(searchCalls()).toHaveLength(0);
        advance(200);
        expect(searchCalls()).toHaveLength(1);
        expect(searchCalls()[0][1]).toEqual({
            cmd: 'get-satellite-search', data: { keyword: 'starlink', limit: 20 },
        });
    });

    it('ignores older replies while the next query is still being debounced', () => {
        const { input } = openDialog();
        fireEvent.change(input, { target: { value: 'star' } });
        advance();
        fireEvent.change(input, { target: { value: 'starlink' } });
        act(() => searchCalls()[0][2]({ success: true, data: [option(1)] }));
        expect(screen.queryByRole('option', { name: 'STARLINK-1 - 1' })).not.toBeInTheDocument();
        advance();
        act(() => searchCalls()[1][2]({ success: true, data: [option(2)] }));
        expect(screen.getByRole('option', { name: 'STARLINK-2 - 2' })).toBeInTheDocument();
    });

    it('ignores replies after clearing the query and cancels pending searches', () => {
        const { input } = openDialog();
        fireEvent.change(input, { target: { value: 'star' } });
        advance();
        fireEvent.change(input, { target: { value: '' } });
        act(() => searchCalls()[0][2]({ success: false, error: 'Stale error' }));
        expect(toastError).not.toHaveBeenCalled();
        fireEvent.change(input, { target: { value: 'starlink' } });
        advance(100);
        fireEvent.change(input, { target: { value: 'st' } });
        advance();
        expect(searchCalls()).toHaveLength(1);
    });

    it('invalidates replies when the dialog closes and does not restore them on reopen', () => {
        const { input } = openDialog();
        fireEvent.change(input, { target: { value: 'star' } });
        advance();
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
        act(() => searchCalls()[0][2]({ success: true, data: [option(1)] }));
        advance();
        fireEvent.click(screen.getByRole('button', { name: /Add target slot/i }));
        fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Satellite Target' }));
        expect(screen.queryByRole('option', { name: 'STARLINK-1 - 1' })).not.toBeInTheDocument();
        advance();
        expect(searchCalls()).toHaveLength(1);
    });

    it('selects a result without searching its reset label', () => {
        const { input } = openDialog();
        fireEvent.change(input, { target: { value: 'star' } });
        advance();
        act(() => searchCalls()[0][2]({ success: true, data: [option(1)] }));
        fireEvent.click(screen.getByRole('option', { name: 'STARLINK-1 - 1' }));
        advance();
        expect(input).toHaveValue('STARLINK-1 - 1');
        expect(searchCalls()).toHaveLength(1);
    });

    it('ignores an in-flight reply after switching target types', () => {
        const { input } = openDialog();
        fireEvent.change(input, { target: { value: 'starlink' } });
        advance();
        fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Target Type' }));
        fireEvent.click(screen.getByRole('option', { name: 'Mission' }));
        act(() => searchCalls()[0][2]({ success: false, error: 'Stale error' }));
        expect(toastError).not.toHaveBeenCalled();
        advance();
        expect(searchCalls()).toHaveLength(1);
    });

    it('cancels scheduled searches on unmount', () => {
        const { input, unmount } = openDialog();
        fireEvent.change(input, { target: { value: 'starlink' } });
        unmount();
        advance();
        expect(searchCalls()).toHaveLength(0);
    });
});

describe('observation tracker tabs', () => {
    beforeEach(() => {
        socket.emit.mockReset().mockImplementation((_event, _request, acknowledge) => {
            acknowledge?.({ success: true, data: [] });
        });
    });

    it('marks only the observation tab as running while the rotator transfers', async () => {
        const target = {
            tracker_id: 'target-1', rotator_id: 'mount',
            tracking_state: { target_name: 'Interactive target', norad_id: 43786 },
        };
        const observation = {
            id: 'obs-pass', enabled: true, status: 'scheduled', rotator: { id: 'mount' },
        };
        const state = {
            targetSatTrack: { trackingState: target.tracking_state, trackerId: 'target-1', trackerViews: {} },
            trackerInstances: { instances: [target] },
            scheduler: { observations: [observation] },
            rigs: { rigs: [] }, rotators: { rotators: [] }, celestialMonitored: { monitored: [] },
        };
        const store = configureStore({ reducer: (current = state, action) => (
            action.type === 'test/update' ? { ...current, ...action.payload } : current
        ) });
        render(<Provider store={store}><TargetSelectorBar /></Provider>);
        const targetTab = () => screen.getByRole('tab', { name: /^Target 1 \|/ });
        const isRunning = (tab) => tab.getAttribute('data-observation-running') === 'true';
        expect(isRunning(targetTab())).toBe(false);

        // The scheduler announces RUNNING before the old rotator selection clears.
        act(() => store.dispatch({ type: 'test/update', payload: {
            scheduler: { observations: [{ ...observation, status: 'running' }] },
        } }));
        expect(isRunning(targetTab())).toBe(false);

        // The old target's delete action must not offer to abort the observation.
        fireEvent.click(within(targetTab()).getByRole('button', { name: 'Delete Interactive target target' }));
        expect(screen.getByRole('dialog')).toHaveTextContent('Delete Target');
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        // Both snapshots can still reference the mount when the OBS tab appears.
        const observer = {
            tracker_id: 'obs-pass', rotator_id: 'mount',
            tracking_state: { target_name: 'Observation target', norad_id: 43786 },
        };
        act(() => store.dispatch({ type: 'test/update', payload: {
            trackerInstances: { instances: [target, observer] },
        } }));
        expect(isRunning(targetTab())).toBe(false);
        expect(isRunning(screen.getByRole('tab', { name: /Observation tracker/ }))).toBe(true);

        act(() => store.dispatch({ type: 'test/update', payload: {
            trackerInstances: { instances: [{ ...target, rotator_id: 'none' }, observer] },
        } }));
        expect(isRunning(targetTab())).toBe(false);
        expect(isRunning(screen.getByRole('tab', { name: /Observation tracker/ }))).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Delete Observation target target' }));
        expect(screen.getByRole('dialog')).toHaveTextContent('Stop Observation');
    });
});

describe('independent hardware tab indicators', () => {
    afterEach(() => vi.useRealTimers());

    it('keeps a disconnected rotator visible beside a tracking rig and expires both reports', () => {
        vi.useFakeTimers();
        const view = {
            hardwareObservedAt: Date.now(), hardwareReceivedAt: Date.now(),
            selectedRotator: 'mount', selectedRadioRig: 'radio',
            rotatorData: {connected: false}, rigData: {connected: true, tracking: true},
        };
        const initial = {
            dashboard: {connected: true},
            targetSatTrack: {trackerId: 'target-1', trackerViews: {'target-1': view}},
            trackerInstances: {instances: [{tracker_id: 'target-1', tracking_state: {norad_id: 25544}}]},
            scheduler: {observations: []}, rigs: {rigs: []}, rotators: {rotators: []},
        };
        const store = configureStore({reducer: (state = initial, action) => action.type === 'test/report'
            ? {...state, targetSatTrack: {...state.targetSatTrack, trackerViews: {'target-1': action.payload}}} : state});
        render(<Provider store={store}><TargetSelectorBar /></Provider>);
        expect(screen.getByLabelText('Rotator: Disconnected')).toHaveAttribute('data-status', 'disconnected');
        expect(screen.getByLabelText('Rig: Tracking')).toHaveAttribute('data-status', 'tracking');
        act(() => vi.advanceTimersByTime(16000));
        expect(screen.getByLabelText('Rotator: Status unavailable')).toHaveAttribute('data-tone', 'attention');
        expect(screen.getByLabelText('Rig: Status unavailable')).toHaveAttribute('data-tone', 'attention');
        // A report received between timer ticks is immediately usable.
        act(() => vi.advanceTimersByTime(50));
        act(() => store.dispatch({type: 'test/report', payload: {...view, hardwareReceivedAt: Date.now()}}));
        expect(screen.getByLabelText('Rig: Tracking')).toHaveAttribute('data-tone', 'active');
    });
});
