import {useState} from 'react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, expect, it, vi} from 'vitest';
import '../../i18n/config.js';
import FeedSettings from './feed-settings.jsx';

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
        server = {...server, consented: data.revoke ? false : server.consented || Boolean(data.terms_version),
            feeds: server.feeds.map(feed => data.revoke && feed.id !== 'observations' ? {...feed, enabled: false}
                : feed.id === data.feed_id ? {...feed, enabled: data.enabled} : feed)};
        server.enabled = server.consented && server.feeds.some(feed => feed.id !== 'observations' && feed.enabled);
        return Promise.resolve({success: true, data: server});
    });
});

function show(role = 'admin', changes = {}) {
    server = {...server, ...changes};
    const changed = vi.fn();
    const store = configureStore({reducer: {auth: () => ({user: {role}})}});
    function Feeds() {
        const [current, setCurrent] = useState(server);
        return <FeedSettings status={current} onChanged={next => {setCurrent(next); changed(next);}}
            observationsEnabled={current.feeds.find(feed => feed.id === 'observations').enabled} locale="en-GB" timezone="UTC" />;
    }
    render(<Provider store={store}><Feeds /></Provider>);
    return changed;
}

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

it('accepts once for all external feeds while preserving independent selections', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    const settings = screen.getByRole('dialog', {name: 'Calendar feeds'});
    await user.click(screen.getByRole('switch', {name: 'Space weather'}));
    const dialog = screen.getByRole('dialog', {name: 'External calendar feeds'});
    expect(screen.getAllByRole('dialog', {hidden: true})).toHaveLength(2);
    expect(settings.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(within(dialog).getByText(/NOAA SWPC/)).toHaveTextContent('Each download contains all three feeds');
    expect(within(dialog).getByText(/public IP address/)).toBeVisible();
    const enable = within(dialog).getByRole('button', {name: 'Agree and enable'});
    expect(enable).toBeDisabled();
    expect(socket.emitWithAck).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(enable);
    await waitFor(() => expect(screen.queryByRole('dialog', {name: 'External calendar feeds'})).not.toBeInTheDocument());
    expect(screen.getByRole('switch', {name: 'Space weather'})).toBeChecked();
    expect(screen.getByRole('switch', {name: 'Satellite announcements'})).not.toBeChecked();
    expect(socket.emitWithAck).toHaveBeenLastCalledWith('api.call', {
        cmd: 'calendar.external.update', data: {feed_id: 'space_weather', enabled: true, terms_version: 'events-1'},
    });
    await user.click(screen.getByRole('switch', {name: 'Launches'}));
    await user.click(screen.getByRole('switch', {name: 'Satellite announcements'}));
    expect(screen.queryByRole('dialog', {name: 'External calendar feeds'})).not.toBeInTheDocument();
    expect(socket.emitWithAck.mock.calls.filter(([, request]) => request.data.terms_version)).toHaveLength(1);
    expect(screen.getByRole('switch', {name: 'Launches'})).toBeChecked();
});

it('canceling consent keeps all external feeds off and resets acceptance', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    await user.click(screen.getByRole('switch', {name: 'Satellite announcements'}));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', {name: 'Close'}));
    await waitFor(() => expect(screen.getByRole('dialog', {name: 'Calendar feeds'})).toBeVisible());
    expect(socket.emitWithAck).not.toHaveBeenCalled();
    await user.click(screen.getByRole('switch', {name: 'Launches'}));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('dialog', {name: 'Calendar feeds'})).toBeVisible());
});

it('keeps acceptance open when persistence fails', async () => {
    socket.emitWithAck.mockResolvedValueOnce({success: false});
    const user = userEvent.setup();
    const changed = show();
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    const announcements = screen.getByRole('switch', {name: 'Satellite announcements'});
    await user.click(announcements);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', {name: 'Agree and enable'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(changed).not.toHaveBeenCalled();
    expect(announcements).not.toBeChecked();
});

it('pauses feeds without revoking consent and exposes a separate withdrawal action', async () => {
    const user = userEvent.setup();
    show('admin', {consented: true, enabled: true, feeds: initial().feeds.map(feed => ({...feed, enabled: true}))});
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    for (const name of ['Satellite announcements', 'Space weather', 'Launches']) {
        await user.click(screen.getByRole('switch', {name}));
    }
    expect(server.consented).toBe(true);
    expect(server.enabled).toBe(false);
    await user.click(screen.getByRole('button', {name: 'Withdraw external-service consent'}));
    expect(socket.emitWithAck).toHaveBeenLastCalledWith('api.call', {cmd: 'calendar.external.update', data: {revoke: true}});
    expect(server.consented).toBe(false);
});

it('operators can inspect the disclosure but cannot change station-wide feeds', async () => {
    const user = userEvent.setup();
    show('operator');
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    screen.getAllByRole('switch').forEach(control => expect(control).toBeDisabled());
    await user.click(screen.getByRole('button', {name: 'About this service'}));
    expect(screen.getByRole('dialog', {name: 'External calendar feeds'})).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(socket.emitWithAck).not.toHaveBeenCalled();
});

it('shows upstream errors inside feed settings', async () => {
    const user = userEvent.setup();
    show('admin', {enabled: true, consented: true, error: 'source_unavailable'});
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    expect(screen.getByRole('status')).toHaveTextContent('Previously cached events may be outdated');
});
