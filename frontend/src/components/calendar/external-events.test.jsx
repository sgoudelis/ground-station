import {useState} from 'react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, expect, it, vi} from 'vitest';
import '../../i18n/config.js';
import FeedSettings from './feed-settings.jsx';
import {ExternalEventsStatus} from './external-events.jsx';

const {socket} = vi.hoisted(() => ({socket: {timeout: vi.fn(), emitWithAck: vi.fn()}}));
vi.mock('../common/socket.jsx', () => ({useSocket: () => ({socket})}));
let server;
const initial = () => ({id: 'gscontrol', enabled: false, consented: false, terms_version: 'events-1', feeds: [
    {id: 'observations', enabled: true}, ...['announcements', 'space_weather', 'launches'].map(id => ({id, enabled: false})),
]});

beforeEach(() => {
    server = initial();
    socket.timeout.mockReset().mockReturnValue(socket);
    socket.emitWithAck.mockReset().mockImplementation((_event, {data}) => {
        const feeds = server.feeds.map(feed => feed.id === data.feed_id ? {...feed, enabled: data.enabled} : feed);
        const selected = feeds.some(feed => feed.id !== 'observations' && feed.enabled);
        const withdraw = data.feed_id !== 'observations' && data.enabled === false && !selected;
        server = {...server, feeds, consented: !withdraw && (server.consented || Boolean(data.terms_version))};
        server.enabled = server.consented && selected;
        return Promise.resolve({success: true, data: server});
    });
});

function show(role = 'admin', changes = {}) {
    server = {...server, ...changes};
    const changed = vi.fn();
    const store = configureStore({reducer: {auth: () => ({user: {role}})}});
    function Feeds() {
        const [current, setCurrent] = useState(server);
        const [open, setOpen] = useState(false);
        return <FeedSettings status={current} onChanged={next => {setCurrent(next); changed(next);}}
            observationsEnabled={current.feeds.find(feed => feed.id === 'observations').enabled}
            open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} />;
    }
    render(<Provider store={store}><Feeds /></Provider>);
    return changed;
}

it.each(['announcements', 'space_weather', 'launches'])('shows successful synchronization when only the %s source is unavailable', feed => {
    render(<ExternalEventsStatus locale="en-GB" timezone="UTC" status={{
        enabled: true, error: 'upstream_feed_unavailable', stale: false,
        last_success_at: '2026-11-23T07:00:00Z',
        feed_status: {[feed]: {complete: false, stale: true, error: 'source_unavailable'}},
    }} />);

    expect(screen.getByRole('status')).toHaveTextContent('Last synchronized:');
    expect(screen.queryByText(/Synchronization failed/)).not.toBeInTheDocument();
    expect(screen.queryByText('Cached events are awaiting an update.')).not.toBeInTheDocument();
});

it('clears the communication warning after a successful download even when an upstream source is still unavailable', () => {
    const status = {enabled: true, last_success_at: '2026-11-23T07:00:00Z'};
    const {rerender} = render(<ExternalEventsStatus locale="en-GB" timezone="UTC"
        status={{...status, error: 'service_unavailable', stale: true}} />);

    expect(screen.getByRole('status')).toHaveTextContent('Synchronization failed. Previously cached events may be outdated.');

    rerender(<ExternalEventsStatus locale="en-GB" timezone="UTC" status={{
        ...status, error: 'upstream_feed_unavailable', stale: false,
        last_success_at: '2026-11-23T07:10:00Z',
        feed_status: {launches: {complete: false, stale: true, error: 'source_unavailable'}},
    }} />);

    expect(screen.getByRole('status')).toHaveTextContent('Last synchronized:');
    expect(screen.queryByText(/Synchronization failed/)).not.toBeInTheDocument();
});

it('saves the local feed station-wide without opening consent', async () => {
    const user = userEvent.setup();
    show();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    const observations = screen.getByRole('switch', {name: 'Local observations'});
    await user.click(observations);
    await waitFor(() => expect(observations).not.toBeChecked());
    expect(socket.emitWithAck).toHaveBeenCalledWith('api.call', {
        cmd: 'calendar.external.update', data: {feed_id: 'observations', enabled: false},
    });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(server.consented).toBe(false);
});

it.each([
    ['Satellite announcements', 'announcements'], ['Space weather', 'space_weather'], ['Launches', 'launches'],
])('enables %s immediately and shares acceptance across external feeds', async (label, id) => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    expect(socket.emitWithAck).not.toHaveBeenCalled();
    await user.click(screen.getByRole('switch', {name: label}));
    expect(screen.getByRole('switch', {name: label})).toBeChecked();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', {name: 'External calendar feeds'})).not.toBeInTheDocument();
    expect(socket.emitWithAck).toHaveBeenLastCalledWith('api.call', {
        cmd: 'calendar.external.update', data: {feed_id: id, enabled: true, terms_version: 'events-1'},
    });
    for (const name of ['Satellite announcements', 'Space weather', 'Launches'].filter(name => name !== label)) {
        expect(screen.getByRole('switch', {name})).not.toBeChecked();
        await user.click(screen.getByRole('switch', {name}));
    }
    expect(screen.queryByRole('dialog', {name: 'External calendar feeds'})).not.toBeInTheDocument();
    expect(socket.emitWithAck.mock.calls.filter(([, request]) => request.data.terms_version)).toHaveLength(1);
    expect(screen.getByRole('switch', {name: 'Launches'})).toBeChecked();
});

it('opens service information only on request without changing any feed', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    const settings = screen.getByRole('dialog', {name: 'Calendar feeds'});
    await user.click(screen.getByRole('button', {name: 'About this service'}));
    const dialog = screen.getByRole('dialog', {name: 'External calendar feeds'});
    expect(screen.getAllByRole('dialog', {hidden: true})).toHaveLength(2);
    expect(settings.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(within(dialog).getByText('When external feeds are enabled, Ground Station contacts an external service to fetch them. The information comes from the publishers and data providers listed below.')).toBeVisible();
    expect(within(dialog).getByRole('heading', {name: 'Calendar feed sources'})).toBeVisible();
    expect(within(dialog).getByRole('link', {name: 'ARISS', exact: true})).toHaveAttribute('href', 'https://www.ariss.org/');
    expect(within(dialog).getByRole('link', {name: 'NOAA Space Weather Prediction Center (SWPC)'})).toBeVisible();
    expect(within(dialog).getByRole('link', {name: 'Launch Library 2 · The Space Devs'})).toBeVisible();
    expect(within(dialog).queryByRole('heading', {name: 'Data shared and retention'})).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', {name: 'Agree and enable'})).not.toBeInTheDocument();
    expect(socket.emitWithAck).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('dialog', {name: 'Calendar feeds'})).toBeVisible());
    expect(screen.getByRole('button', {name: 'About this service'})).toHaveFocus();
    expect(socket.emitWithAck).not.toHaveBeenCalled();
});

it('keeps a failed first enable off, shows an inline error, and allows retry', async () => {
    socket.emitWithAck.mockResolvedValueOnce({success: false});
    const user = userEvent.setup();
    const changed = show();
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    const announcements = screen.getByRole('switch', {name: 'Satellite announcements'});
    await user.click(announcements);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(changed).not.toHaveBeenCalled();
    expect(announcements).not.toBeChecked();
    expect(screen.queryByRole('dialog', {name: 'External calendar feeds'})).not.toBeInTheDocument();
    await user.click(announcements);
    await waitFor(() => expect(announcements).toBeChecked());
    expect(changed).toHaveBeenCalledTimes(1);
});

it('withdraws consent when the last external feed is switched off and re-enables directly', async () => {
    const user = userEvent.setup();
    show('admin', {consented: true, enabled: true, feeds: initial().feeds.map(feed => ({...feed, enabled: true}))});
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    expect(screen.queryByRole('button', {name: 'Withdraw external-service consent'})).not.toBeInTheDocument();
    for (const name of ['Satellite announcements', 'Space weather']) {
        await user.click(screen.getByRole('switch', {name}));
        expect(server.consented).toBe(true);
        expect(server.enabled).toBe(true);
    }
    await user.click(screen.getByRole('switch', {name: 'Launches'}));
    expect(server.enabled).toBe(false);
    expect(server.consented).toBe(false);
    expect(screen.getByRole('switch', {name: 'Local observations'})).toBeChecked();
    expect(socket.emitWithAck).toHaveBeenLastCalledWith('api.call', {
        cmd: 'calendar.external.update', data: {feed_id: 'launches', enabled: false},
    });
    await user.click(screen.getByRole('switch', {name: 'Space weather'}));
    expect(screen.queryByRole('dialog', {name: 'External calendar feeds'})).not.toBeInTheDocument();
    expect(screen.getByRole('switch', {name: 'Space weather'})).toBeChecked();
    expect(socket.emitWithAck).toHaveBeenCalledTimes(4);
    expect(socket.emitWithAck).toHaveBeenLastCalledWith('api.call', {
        cmd: 'calendar.external.update', data: {feed_id: 'space_weather', enabled: true, terms_version: 'events-1'},
    });
});

it('does not withdraw external consent when local observations are switched off', async () => {
    const user = userEvent.setup();
    show('admin', {consented: true, enabled: true, feeds: initial().feeds.map(feed => ({...feed,
        enabled: ['observations', 'space_weather'].includes(feed.id)}))});
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    await user.click(screen.getByRole('switch', {name: 'Local observations'}));
    expect(server.consented).toBe(true);
    expect(screen.getByRole('switch', {name: 'Space weather'})).toBeChecked();
});

it('preserves consent and the last external feed if saving the off switch fails', async () => {
    const user = userEvent.setup();
    show('admin', {consented: true, enabled: true, feeds: initial().feeds.map(feed => ({...feed,
        enabled: ['observations', 'launches'].includes(feed.id)}))});
    socket.emitWithAck.mockResolvedValueOnce({success: false});
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    const launches = screen.getByRole('switch', {name: 'Launches'});
    await user.click(launches);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(launches).toBeChecked();
    expect(server.consented).toBe(true);
    await user.click(launches);
    await waitFor(() => expect(launches).not.toBeChecked());
    expect(server.consented).toBe(false);
});

it('operators can inspect the disclosure but cannot change station-wide feeds', async () => {
    const user = userEvent.setup();
    show('operator');
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    screen.getAllByRole('switch').forEach(control => expect(control).toBeDisabled());
    expect(screen.getAllByText('Administrators manage this setting for all users.')).toHaveLength(1);
    await user.click(screen.getByRole('button', {name: 'About this service'}));
    expect(screen.getByRole('dialog', {name: 'External calendar feeds'})).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(socket.emitWithAck).not.toHaveBeenCalled();
});

it('shows feed groups without consent indicators or duplicate synchronization messages', async () => {
    const user = userEvent.setup();
    show('admin', {enabled: true, consented: true, error: 'source_unavailable'});
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    expect(screen.getByRole('heading', {name: 'Station data'})).toBeVisible();
    expect(screen.getByRole('heading', {name: 'External feeds', exact: true})).toBeVisible();
    expect(screen.getByText('Settings apply to everyone using this station.')).toBeVisible();
    expect(screen.queryByText('Consent granted')).not.toBeInTheDocument();
    expect(screen.queryByText('Consent required')).not.toBeInTheDocument();
    expect(screen.getByText('Changes save automatically.')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/Previously cached events may be outdated/)).not.toBeInTheDocument();
});

it('indicates which feed is saving and prevents overlapping changes', async () => {
    const user = userEvent.setup();
    show('admin', {consented: true});
    let finish;
    socket.emitWithAck.mockReturnValueOnce(new Promise(resolve => {finish = resolve;}));
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    const observations = screen.getByRole('switch', {name: 'Local observations'});
    await user.click(observations);
    expect(screen.getByRole('progressbar', {name: 'Saving…'})).toBeVisible();
    expect(observations).toHaveAttribute('aria-busy', 'true');
    screen.getAllByRole('switch').forEach(control => expect(control).toBeDisabled());
    await user.click(screen.getByText('Launches'));
    await user.keyboard('{Escape}');
    expect(socket.emitWithAck).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', {name: 'Calendar feeds'})).toBeVisible();
    await act(async () => finish({success: true, data: {...server,
        feeds: server.feeds.map(feed => feed.id === 'observations' ? {...feed, enabled: false} : feed)}}));
    expect(observations).not.toBeChecked();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    screen.getAllByRole('switch').forEach(control => expect(control).toBeEnabled());
});

it.each(['Local observations', 'Space weather'])('keeps %s unchanged on save failure and allows retry', async name => {
    const user = userEvent.setup();
    show('admin', {consented: true});
    socket.emitWithAck.mockResolvedValueOnce({success: false});
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    const control = screen.getByRole('switch', {name});
    const checked = control.checked;
    await user.click(control);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(control.checked).toBe(checked);
    expect(control).toHaveAccessibleDescription(/Could not save/);
    await user.click(control);
    await waitFor(() => expect(control.checked).toBe(!checked));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
