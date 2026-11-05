import React, { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/config.js';
import { setupTheme } from '../../theme.js';
import schedulerReducer, { observationStatusUpdated } from '../scheduler/scheduler-slice.jsx';
import decodersReducer from '../decoders/decoders-slice.jsx';
import ObservationsPopover from './observations-popover.jsx';

const { socket, joinSdr, showError } = vi.hoisted(() => ({
    socket: { connected: true },
    joinSdr: vi.fn(),
    showError: vi.fn(),
}));
vi.mock('../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('../waterfall/sdr-join.js', () => ({ joinSdr }));
vi.mock('../../utils/toast-with-timestamp.jsx', () => ({ toast: { error: showError } }));

const NOW = new Date('2026-11-05T10:00:00Z').getTime();
const at = (seconds) => new Date(NOW + seconds * 1000).toISOString();
const automated = {
    id: 'obs-1', name: 'Morning ISS pass', satellite: { name: 'ISS' },
    status: 'running', enabled: true, task_start: at(-60), task_end: at(125),
    sessions: [
        { sdr: { id: 'sdr-1', name: 'Receiver one' }, tasks: [{ type: 'decoder', config: { decoder_type: 'aprs' } }] },
        { sdr: { id: 'sdr-2', name: 'Receiver two' }, tasks: [{ type: 'iq_recording' }, { type: 'audio_recording' }] },
    ],
};
const manual = {
    sdr_id: 'sdr-3', background: { enabled: true, controller_connected: false },
    metadata: { username: 'operator' },
    vfos: { 1: { active: true, center_freq: 145800000, decoder: 'aprs', modulation: 'fm' } },
};

function Harness() {
    const [anchor, setAnchor] = useState(null);
    const location = useLocation();
    return (
        <>
            <div data-testid="current-page">{location.pathname}</div>
            <button onClick={(event) => setAnchor(event.currentTarget)}>Observation shortcut</button>
            <ObservationsPopover anchorEl={anchor} onOpen={(event) => setAnchor(event.currentTarget)}
                onClose={() => setAnchor(null)} />
        </>
    );
}

function setup({ observations = [], sessions = {}, streaming = false, sdrId = 'sdr-3' } = {}) {
    const initialSessions = { runtimeSnapshot: { data: { sessions, sdrs: {} } } };
    const store = configureStore({
        reducer: {
            scheduler: schedulerReducer,
            decoders: decodersReducer,
            sessions: (state = initialSessions, action) => action.type === 'runtime'
                ? { runtimeSnapshot: { data: { sessions: action.payload, sdrs: {} } } } : state,
            waterfall: () => ({ isStreaming: streaming, selectedSDRId: sdrId, joinedSdrId: sdrId }),
            preferences: () => ({ preferences: [{ name: 'timezone', value: 'UTC' }, { name: 'locale', value: 'en-GB' }] }),
        },
        preloadedState: {
            scheduler: { ...schedulerReducer(undefined, { type: '@@init' }), observations },
            decoders: { ...decodersReducer(undefined, { type: '@@init' }), observedSessionIds: ['joined-session'] },
        },
    });
    render(
        <Provider store={store}>
            <ThemeProvider theme={setupTheme()}>
                <MemoryRouter initialEntries={['/waterfall']}><Harness /></MemoryRouter>
            </ThemeProvider>
        </Provider>
    );
    return store;
}

// MUI hides the underlying toolbar from assistive technology while the modal
// popover is open; retain access to its expanded state in these assertions.
const toolbarButton = () => screen.getByRole('button', { name: 'Observations', hidden: true });
const openPopover = () => fireEvent.click(toolbarButton());

describe('observations popover', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        vi.clearAllMocks();
        joinSdr.mockResolvedValue({ success: true });
    });
    afterEach(() => vi.useRealTimers());

    it('hides the icon until activity starts, even with an upcoming observation, and links to the scheduler', () => {
        const store = setup({ observations: [{ ...automated, status: 'scheduled', task_start: at(120) }] });
        expect(screen.queryByRole('button', { name: 'Observations' })).not.toBeInTheDocument();
        act(() => store.dispatch({ type: 'runtime', payload: { manual } }));
        expect(toolbarButton()).toHaveAttribute('aria-expanded', 'false');
        openPopover();
        expect(screen.getByRole('dialog', { name: 'Observations' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Open scheduler' }));
        expect(screen.getByTestId('current-page')).toHaveTextContent('/scheduler');
        expect(toolbarButton()).toHaveAttribute('aria-expanded', 'false');
    });

    it('counts a multi-SDR automated observation once alongside manual background sessions', () => {
        setup({
            observations: [automated],
            sessions: {
                manual,
                foreground: { sdr_id: 'sdr-4', background: { enabled: false } },
                'internal:obs-1:one': { ...manual, is_internal: true, metadata: { observation_id: 'obs-1' } },
                'internal:obs-1:two': { ...manual, is_internal: true, metadata: { observation_id: 'obs-1' } },
            },
        });
        expect(within(toolbarButton()).getByText('2')).toBeInTheDocument();
        openPopover();
        expect(screen.getByRole('heading', { name: 'Automated' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Manual background' })).toBeInTheDocument();
        expect(screen.getAllByText('ISS')).toHaveLength(1);
        expect(screen.getByText('Receiver one')).toBeInTheDocument();
        expect(screen.getByText('Receiver two')).toBeInTheDocument();
        expect(screen.getByText('Tasks: APRS decoder')).toBeInTheDocument();
        expect(screen.getByText('Tasks: IQ recording · Audio recording')).toBeInTheDocument();
        expect(screen.getAllByText('operator')).toHaveLength(1);
        expect(screen.getByText('VFO 1: 145.800000 MHz · aprs')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Take control' })).not.toBeInTheDocument();
    });

    it('opens observation details from the shared shortcut without claiming the SDR', () => {
        const store = setup({ observations: [automated], streaming: true });
        fireEvent.click(screen.getByRole('button', { name: 'Observation shortcut' }));
        expect(toolbarButton()).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'View observation' }));
        expect(store.getState().scheduler.selectedObservation.id).toBe('obs-1');
        expect(store.getState().scheduler.dialogOpen).toBe(true);
        expect(screen.getByTestId('current-page')).toHaveTextContent('/waterfall');
        expect(toolbarButton()).toHaveAttribute('aria-expanded', 'false');
        expect(joinSdr).not.toHaveBeenCalled();
    });

    it('appears when an observation starts and closes when the last run ends', () => {
        const store = setup({ observations: [{ ...automated, enabled: false, status: 'scheduled' }] });
        expect(screen.queryByRole('button', { name: 'Observations' })).not.toBeInTheDocument();
        act(() => store.dispatch(observationStatusUpdated({ id: 'obs-1', status: 'running' })));
        expect(toolbarButton()).toHaveAttribute('aria-expanded', 'false');
        openPopover();
        expect(screen.getByText('ISS')).toBeInTheDocument();
        act(() => vi.advanceTimersByTime(1000));
        expect(screen.getByText('Running · 2m 4s remaining')).toBeInTheDocument();
        act(() => store.dispatch(observationStatusUpdated({ id: 'obs-1', status: 'completed' })));
        expect(screen.queryByRole('dialog', { name: 'Observations' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Observations', hidden: true })).not.toBeInTheDocument();
        expect(screen.queryByText('ISS')).not.toBeInTheDocument();
        act(() => store.dispatch(observationStatusUpdated({ id: 'obs-1', status: 'running' })));
        expect(toolbarButton()).toHaveAttribute('aria-expanded', 'false');
    });

    it('shows only the next enabled future observation using task times before pass times', () => {
        const store = setup({ observations: [
            automated,
            { ...automated, id: 'later', status: 'scheduled', task_start: at(600), satellite: { name: 'Later satellite' } },
            { ...automated, id: 'disabled', status: 'scheduled', enabled: false, task_start: at(5), satellite: { name: 'Disabled satellite' } },
            { ...automated, id: 'past', status: 'scheduled', task_start: at(-5), satellite: { name: 'Past satellite' } },
            { ...automated, id: 'invalid', status: 'scheduled', task_start: 'invalid', satellite: { name: 'Invalid satellite' } },
            { ...automated, id: 'next', status: 'scheduled', task_start: at(120), pass: { event_start: at(300) }, satellite: { name: 'Next satellite' } },
        ] });
        openPopover();
        expect(screen.getByText('Next scheduled')).toBeInTheDocument();
        expect(screen.getByText('Next satellite')).toBeInTheDocument();
        expect(screen.getByText(/Starts .*10:02.*UTC/)).toBeInTheDocument();
        for (const name of ['Later satellite', 'Disabled satellite', 'Past satellite', 'Invalid satellite']) {
            expect(screen.queryByText(name)).not.toBeInTheDocument();
        }
        fireEvent.click(screen.getAllByRole('button', { name: 'View observation' }).at(-1));
        expect(store.getState().scheduler.selectedObservation.id).toBe('next');
    });

    it('preserves JOIN hydration and only watches manual sessions on the joined SDR after a fresh snapshot', () => {
        const store = setup({ sessions: { manual }, streaming: true });
        expect(store.getState().decoders.observedSessionIds).toEqual(['joined-session']);
        act(() => store.dispatch({ type: 'runtime', payload: {
            manual,
            other: { ...manual, sdr_id: 'sdr-4' },
            'internal:obs-1': { ...manual, is_internal: true },
        } }));
        expect(store.getState().decoders.observedSessionIds).toEqual(['manual']);
    });

    it('retains the manual take-control action and closes after a successful claim', async () => {
        setup({ sessions: { manual }, streaming: true });
        openPopover();
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Take control' })));
        expect(joinSdr).toHaveBeenCalledExactlyOnceWith(socket, expect.any(Function), 'sdr-3', 'claim-sdr');
        expect(toolbarButton()).toHaveAttribute('aria-expanded', 'false');
    });

    it('keeps manual sessions open with an error when a claim fails', async () => {
        joinSdr.mockResolvedValue({ success: false, error: 'Receiver unavailable' });
        setup({ sessions: { manual }, streaming: true });
        openPopover();
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Take control' })));
        expect(showError).toHaveBeenCalledWith('Receiver unavailable');
        expect(toolbarButton()).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('button', { name: 'Take control' })).toBeEnabled();
    });
});
