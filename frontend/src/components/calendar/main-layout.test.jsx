import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {ThemeProvider} from '@mui/material/styles';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import '../../i18n/config.js';
import {setupTheme} from '../../theme.js';
import {dayKey} from './dates.js';
import CalendarPage from './main-layout.jsx';
import schedulerReducer from '../scheduler/scheduler-slice.jsx';

const {socket, handlers} = vi.hoisted(() => {
    const handlers = new Map();
    const socket = {timeout: vi.fn(), emitWithAck: vi.fn(), emit: vi.fn(),
        on: vi.fn((name, callback) => handlers.set(name, callback)),
        off: vi.fn((name, callback) => {if (handlers.get(name) === callback) handlers.delete(name);}),
    };
    return {socket, handlers};
});
vi.mock('../common/socket.jsx', () => ({useSocket: () => ({socket})}));

function observation(id, satellite, start, end) {
    return {id: `observations:${id}`, source_id: id, source: 'observations', kind: 'observation',
        title: `${satellite} pass ${id}`, satellites: [{name: satellite, norad_id: 25544}],
        start, end, status: 'scheduled', enabled: true,
        frequencies: [{hz: 145800000, mode: 'FM'}],
        observation: {monitored_satellite_id: 'monitor-1', pass_start: new Date(Date.parse(start) - 120000).toISOString(),
            pass_end: new Date(Date.parse(end) + 60000).toISOString(), peak_altitude: 72.5}};
}
const fixtures = [
    observation('earlier', 'ISS', '2026-11-17T09:00:00Z', '2026-11-17T09:10:00Z'),
    ...Array.from({length: 4}, (_, index) => observation(String(index), index === 1 ? 'AO-91' : 'ISS',
        `2026-11-18T${10 + index}:00:00Z`, `2026-11-18T${10 + index}:10:00Z`)),
];
const reply = events => ({success: true, data: {events, sources: [{id: 'observations'}]}});

beforeEach(() => {
    localStorage.clear();
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-11-18T12:00:00Z').getTime());
    handlers.clear();
    socket.emit.mockReset();
    socket.timeout.mockReset().mockReturnValue(socket);
    socket.emitWithAck.mockReset().mockImplementation((_event, {data}) => Promise.resolve(reply(
        fixtures.filter(event => dayKey(event.start, data.timezone) < data.end && dayKey(event.end, data.timezone) >= data.start),
    )));
});
afterEach(() => vi.restoreAllMocks());

async function renderCalendar(userId = 'admin-1') {
    const store = configureStore({reducer: {
        auth: () => ({user: {id: userId, role: 'admin'}}),
        scheduler: schedulerReducer,
        preferences: () => ({preferences: [{name: 'timezone', value: 'Asia/Tokyo'}, {name: 'locale', value: 'en-GB'}]}),
    }});
    const result = render(<Provider store={store}><ThemeProvider theme={setupTheme('dark')}><CalendarPage /></ThemeProvider></Provider>);
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'false'));
    return {...result, store};
}

it('requests the visible range, navigates periods and views, and returns to today', async () => {
    const user = userEvent.setup();
    await renderCalendar();
    expect(socket.emitWithAck).toHaveBeenLastCalledWith('api.call', {
        cmd: 'get-calendar-events', data: {start: '2026-10-26', end: '2026-12-07', timezone: 'UTC'},
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'November 2026'})).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Next period'}));
    expect(screen.getByRole('heading', {name: 'December 2026'})).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Today'}));
    expect(screen.getByRole('heading', {name: 'November 2026'})).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Week', exact: true}));
    expect(screen.getByRole('heading', {name: /16 Nov.*22 Nov 2026/})).toBeVisible();
    expect(socket.emitWithAck).toHaveBeenLastCalledWith('api.call', {
        cmd: 'get-calendar-events', data: {start: '2026-11-16', end: '2026-11-23', timezone: 'UTC'},
    });
    await user.click(screen.getByRole('button', {name: 'Agenda', exact: true}));
    expect(screen.getByRole('heading', {name: 'November 2026'})).toBeVisible();
    expect(socket.emitWithAck).toHaveBeenLastCalledWith('api.call', {
        cmd: 'get-calendar-events', data: {start: '2026-11-01', end: '2026-12-01', timezone: 'UTC'},
    });
});

it('combines search and activity filters and recovers from an empty result', async () => {
    const user = userEvent.setup();
    await renderCalendar();
    await user.click(screen.getByRole('button', {name: 'Agenda', exact: true}));
    await user.type(screen.getByRole('textbox', {name: 'Search events'}), 'ISS');
    const calendar = screen.getByRole('region');
    expect(within(calendar).queryByRole('button', {name: /AO-91/})).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', {name: 'Activity'}));
    await user.click(screen.getByRole('option', {name: 'Telemetry'}));
    expect(within(calendar).getByText('No events in this view')).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Reset filters'}));
    expect(within(calendar).getByRole('button', {name: /AO-91/})).toBeVisible();
});

it('refreshes announcements and observations while preserving the visible period and filters', async () => {
    const user = userEvent.setup();
    await renderCalendar();
    await user.click(screen.getByRole('button', {name: 'Agenda', exact: true}));
    await user.type(screen.getByRole('textbox', {name: 'Search events'}), 'ISS');
    let finish;
    socket.emitWithAck.mockReturnValueOnce(new Promise(resolve => {finish = resolve;}));
    const refresh = screen.getByRole('button', {name: 'Refresh', exact: true});
    await user.click(refresh);
    expect(refresh).toBeDisabled();
    expect(socket.emitWithAck).toHaveBeenLastCalledWith('api.call', {
        cmd: 'refresh-calendar-events', data: {start: '2026-11-01', end: '2026-12-01', timezone: 'UTC'},
    });
    const updated = observation('new', 'ISS', '2026-11-18T15:00:00Z', '2026-11-18T15:10:00Z');
    const announcement = {id: 'gscontrol:new', source: 'gscontrol', source_id: 'new', kind: 'sstv',
        title: 'Fresh ISS announcement', start: '2026-11-18', end: '2026-11-19',
        time_precision: 'date', satellites: [{name: 'ISS'}]};
    await act(async () => finish(reply([updated, announcement])));
    expect(refresh).toBeEnabled();
    expect(screen.getByRole('button', {name: /ISS pass new/})).toBeVisible();
    expect(screen.getByRole('button', {name: /Fresh ISS announcement/})).toBeVisible();
    expect(screen.queryByRole('button', {name: /ISS pass earlier/})).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', {name: 'Search events'})).toHaveValue('ISS');
    expect(screen.getByRole('button', {name: 'Agenda', exact: true})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', {name: 'November 2026'})).toBeVisible();
});

it('remembers the local feed choice per user while keeping announcements and refresh available', async () => {
    const user = userEvent.setup();
    const announcement = {id: 'gscontrol:feed', source: 'gscontrol', source_id: 'feed', kind: 'sstv',
        title: 'Subscribed announcement', start: '2026-11-18', end: '2026-11-19',
        time_precision: 'date', satellites: [{name: 'ISS'}]};
    socket.emitWithAck.mockResolvedValue({success: true, data: {
        events: [fixtures[0], announcement], sources: [{id: 'gscontrol', enabled: true}],
    }});
    const {unmount} = await renderCalendar();
    await user.click(screen.getByRole('button', {name: 'Agenda', exact: true}));
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    await user.click(screen.getByRole('switch', {name: 'Local observations'}));
    expect(screen.getByRole('switch', {name: 'Local observations'})).not.toBeChecked();
    await user.click(within(screen.getByRole('dialog', {name: 'Calendar feeds'})).getByRole('button', {name: 'Close'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', {name: /ISS pass earlier/})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: /Subscribed announcement/})).toBeVisible();
    expect(screen.getByText('Events in this period: 1')).toBeVisible();
    expect(socket.emitWithAck.mock.calls.every(([, request]) => request.cmd === 'get-calendar-events')).toBe(true);
    await user.click(screen.getByRole('button', {name: 'Refresh', exact: true}));
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'false'));
    expect(screen.queryByRole('button', {name: /ISS pass earlier/})).not.toBeInTheDocument();
    unmount();
    const other = await renderCalendar('admin-2');
    expect(screen.getByRole('button', {name: /ISS pass earlier/})).toBeVisible();
    other.unmount();
    await renderCalendar();
    expect(screen.queryByRole('button', {name: /ISS pass earlier/})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    await user.click(screen.getByRole('switch', {name: 'Local observations'}));
    await user.click(within(screen.getByRole('dialog', {name: 'Calendar feeds'})).getByRole('button', {name: 'Close'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', {name: /ISS pass earlier/})).toBeVisible();
});

it('expands crowded days and shows task, pass, frequency, and status details without origin', async () => {
    const user = userEvent.setup();
    await renderCalendar();
    const today = screen.getByLabelText('Wednesday, 18 November 2026', {selector: 'div'});
    await user.click(within(today).getByRole('button', {name: /more/}));
    expect(screen.getByRole('button', {name: 'Week', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('combobox', {name: 'Timezone'}));
    await user.click(screen.getByRole('option', {name: 'Asia/Tokyo'}));
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'false'));
    await user.click(screen.getByRole('button', {name: /ISS pass earlier/}));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Asia/Tokyo')).toBeVisible();
    expect(within(dialog).getByText('145.8 MHz · FM')).toBeVisible();
    expect(within(dialog).getByText('Tue, 17 Nov 2026, 18:00')).toBeVisible();
    expect(within(dialog).getByText('Tue, 17 Nov 2026, 17:58')).toBeVisible();
    expect(within(dialog).getByText('Local observation')).toBeVisible();
    expect(within(dialog).getByRole('region', {name: 'Scheduled task'})).toBeVisible();
    expect(within(dialog).getByRole('region', {name: 'Satellite pass'})).toBeVisible();
    expect(within(dialog).getByText('Duration: 10 mins')).toBeVisible();
    expect(within(dialog).queryByRole('region', {name: 'Origin'})).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Generated from a monitored satellite')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Scheduled')).toBeVisible();
    expect(within(dialog).getByText('72.5°')).toBeVisible();
    expect(within(dialog).queryByText(/fictional|sample/i)).not.toBeInTheDocument();
    socket.emitWithAck.mockResolvedValue(reply(fixtures.map(event => event.source_id === 'earlier' ? {...event, status: 'running'} : event)));
    act(() => handlers.get('observation-status-update')({id: 'earlier', status: 'running'}));
    await waitFor(() => expect(within(dialog).getByText('Running')).toBeVisible());
    socket.emitWithAck.mockResolvedValue(reply(fixtures.filter(event => event.source_id !== 'earlier')));
    act(() => handlers.get('scheduled-observations-changed')());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('shows an honest empty state when the backend has no observations for the selected dates', async () => {
    const user = userEvent.setup();
    await renderCalendar();
    fireEvent.change(screen.getByLabelText('Go to date'), {target: {value: '2028-02-29'}});
    await user.click(screen.getByRole('button', {name: 'Agenda', exact: true}));
    await waitFor(() => expect(screen.getByText('No events in this view')).toBeVisible());
    expect(screen.getByText('Events in this period: 0')).toBeVisible();
});

it('shows cached announcements with source links and date precision across timezones', async () => {
    const user = userEvent.setup();
    socket.emitWithAck.mockResolvedValue({success: true, data: {
        events: [{id: 'gscontrol:dated', source: 'gscontrol', source_id: 'dated', kind: 'ssdv',
            title: 'Reviewed SSDV announcement', start: '2026-11-18', end: '2026-11-20',
            time_precision: 'date', satellites: [{name: 'ISS'}], source_url: 'https://example.org/activity'}],
        sources: [{id: 'gscontrol', enabled: true, terms_version: 'events-1'}],
    }});
    await renderCalendar();
    expect(screen.queryByRole('switch', {name: 'Satellite announcements'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    const feeds = screen.getByRole('dialog', {name: 'Calendar feeds'});
    expect(within(feeds).getByRole('switch', {name: 'Satellite announcements'})).toBeChecked();
    await user.click(within(feeds).getByRole('button', {name: 'Close'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('combobox', {name: 'Timezone'}));
    await user.click(screen.getByRole('option', {name: 'Asia/Tokyo'}));
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'false'));
    const day = screen.getByLabelText('Wednesday, 18 November 2026', {selector: 'div'});
    await user.click(within(day).getByRole('button', {name: /Reviewed SSDV announcement/}));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('18 Nov 2026')).toBeVisible();
    expect(within(dialog).getByText('19 Nov 2026')).toBeVisible();
    expect(within(dialog).getByText('Date only')).toBeVisible();
    expect(within(dialog).queryByText('GS Control')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('link', {name: 'example.org'})).toHaveAttribute('href', 'https://example.org/activity');
    expect(within(dialog).getByRole('link', {name: 'Open original source'})).toHaveAttribute('href', 'https://example.org/activity');
    expect(within(dialog).queryByRole('button', {name: 'Open observation'})).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', {name: 'View results'})).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Duration:/)).not.toBeInTheDocument();
    expect(socket.emitWithAck.mock.calls.every(([, request]) => request.cmd === 'get-calendar-events')).toBe(true);
});

it('distinguishes request failures from an empty calendar and supports retry', async () => {
    const user = userEvent.setup();
    socket.emitWithAck.mockRejectedValueOnce(new Error('timeout'));
    await renderCalendar();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load calendar events');
    expect(screen.queryByText('No events in this view')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Retry'}));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getAllByRole('button', {name: /ISS pass/}).length).toBeGreaterThan(0);
});

it('opens the existing observation editor with a freshly loaded complete record', async () => {
    const user = userEvent.setup();
    const {store} = await renderCalendar();
    await user.click(screen.getByRole('button', {name: /ISS pass earlier/}));
    const fullObservation = {id: 'earlier', name: 'ISS pass earlier', satellite: {name: 'ISS'},
        sessions: [{sdr: {id: 'receiver-1'}, tasks: [{type: 'iq_recording'}]}]};
    socket.emitWithAck.mockResolvedValueOnce({success: true, data: fullObservation});

    await user.click(screen.getByRole('button', {name: 'Open observation'}));

    expect(socket.emitWithAck).toHaveBeenLastCalledWith('api.call', {
        cmd: 'get-scheduled-observations', data: {observation_id: 'earlier'},
    });
    await waitFor(() => expect(store.getState().scheduler.dialogOpen).toBe(true));
    expect(store.getState().scheduler.selectedObservation).toEqual(fullObservation);
    expect(screen.getByRole('dialog', {name: 'ISS'})).toBeVisible();
});

it('opens the scheduler results dialog with the selected observation timeline and products', async () => {
    const user = userEvent.setup();
    const {store} = await renderCalendar();
    await user.click(screen.getByRole('button', {name: /ISS pass earlier/}));
    const fullObservation = {id: 'earlier', name: 'ISS pass earlier', satellite: {name: 'ISS'},
        status: 'completed', execution_log: [{timestamp: '2026-11-17T09:10:00Z', level: 'info', event: 'IQ recording complete'}]};
    socket.emitWithAck.mockResolvedValueOnce({success: true, data: fullObservation});
    socket.emit.mockImplementation((_event, {cmd}, callback) => callback({success: true,
        data: cmd === 'filebrowser.query' ? {items: [{type: 'snapshot', name: 'ISS waterfall.png',
            url: '/files/ISS-waterfall.png', size: 2048}]} : fullObservation}));

    await user.click(screen.getByRole('button', {name: 'View results'}));

    expect(socket.emitWithAck).toHaveBeenLastCalledWith('api.call', {
        cmd: 'get-scheduled-observations', data: {observation_id: 'earlier'},
    });
    expect(await screen.findByText('IQ recording complete')).toBeVisible();
    expect(screen.getByRole('tab', {name: 'Execution Timeline'})).toHaveAttribute('aria-selected', 'true');
    expect(socket.emit).toHaveBeenCalledWith('api.call', expect.objectContaining({cmd: 'filebrowser.query',
        data: expect.objectContaining({observationId: 'earlier', sessionId: 'internal:earlier'})}), expect.any(Function));
    expect(store.getState().scheduler.dialogOpen).toBe(false);

    await user.click(screen.getByRole('tab', {name: 'Downloaded Data'}));
    await user.click(screen.getByRole('button', {name: /ISS waterfall.png/}));
    expect(screen.getByRole('img', {name: 'ISS waterfall.png'})).toHaveAttribute('src', '/files/ISS-waterfall.png');
    // Close the product preview, then the results dialog, and return to the observation details.
    await user.click(within(screen.getAllByRole('dialog').at(-1)).getByRole('button', {name: 'Close'}));
    await waitFor(() => expect(screen.queryByRole('img', {name: 'ISS waterfall.png'})).not.toBeInTheDocument());
    await user.click(within(screen.getByRole('dialog')).getByRole('button', {name: 'Close'}));
    await waitFor(() => expect(screen.getByRole('dialog', {name: 'ISS'})).toBeVisible());
    expect(screen.getByRole('region', {name: 'Scheduled task'})).toBeVisible();
});

it.each(['Open observation', 'View results'])('keeps details open when %s fails and allows retry', async button => {
    const user = userEvent.setup();
    const {store} = await renderCalendar();
    await user.click(screen.getByRole('button', {name: /ISS pass earlier/}));
    socket.emitWithAck.mockRejectedValueOnce(new Error('timeout'));

    await user.click(screen.getByRole('button', {name: button}));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open the observation');
    expect(store.getState().scheduler.dialogOpen).toBe(false);
    socket.emitWithAck.mockResolvedValueOnce({success: true, data: {id: 'earlier', sessions: []}});
    await user.click(screen.getByRole('button', {name: 'Open observation'}));
    await waitFor(() => expect(store.getState().scheduler.dialogOpen).toBe(true));
});

it.each(['Open observation', 'View results'])('ignores a %s response after its calendar dialog has been closed', async button => {
    const user = userEvent.setup();
    const {store} = await renderCalendar();
    await user.click(screen.getByRole('button', {name: /ISS pass earlier/}));
    let resolveRecord;
    socket.emitWithAck.mockReturnValueOnce(new Promise(resolve => {resolveRecord = resolve;}));
    await user.click(screen.getByRole('button', {name: button}));
    expect(screen.getByRole('button', {name: 'Open observation'})).toBeDisabled();
    await user.click(within(screen.getByRole('dialog')).getAllByRole('button', {name: 'Close', exact: true}).at(-1));
    await act(async () => resolveRecord({success: true, data: {id: 'earlier', sessions: []}}));
    expect(store.getState().scheduler.dialogOpen).toBe(false);
    expect(store.getState().scheduler.selectedObservation).toBeNull();
    expect(screen.queryByRole('tab', {name: 'Execution Timeline'})).not.toBeInTheDocument();
});

it('preserves uncertain source timing without inventing precise times or empty reception fields', async () => {
    const user = userEvent.setup();
    socket.emitWithAck.mockResolvedValue(reply([{
        id: 'gscontrol:uncertain', source: 'gscontrol', source_id: 'uncertain', kind: 'sstv',
        title: 'SSTV weekend', start: '2026-11-18', end: '2026-11-20', time_precision: 'unspecified',
        satellites: [{name: 'ISS'}], description: 'First paragraph.\n\nSecond paragraph.',
        timing_note: '18:00–20:00; timezone not published.',
    }]));
    await renderCalendar();
    const day = screen.getByLabelText('Wednesday, 18 November 2026', {selector: 'div'});
    await user.click(within(day).getByRole('button', {name: /SSTV weekend/}));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Time or timezone unspecified')).toBeVisible();
    expect(dialog.getByText('18:00–20:00; timezone not published.')).toBeVisible();
    expect(dialog.getByText('First paragraph. Second paragraph.')).toBeVisible();
    expect(dialog.getByRole('region', {name: 'Activity window'})).toBeVisible();
    expect(dialog.queryByRole('region', {name: 'Reception'})).not.toBeInTheDocument();
    expect(dialog.queryByText(/Duration:/)).not.toBeInTheDocument();
    expect(dialog.queryByRole('link', {name: 'Open original source'})).not.toBeInTheDocument();
    expect(dialog.queryByRole('button', {name: 'Open observation'})).not.toBeInTheDocument();
});
