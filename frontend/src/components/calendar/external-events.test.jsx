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
const disabled = {id: 'gscontrol', enabled: false, terms_version: 'events-1'};

beforeEach(() => {
    socket.timeout.mockReset().mockReturnValue(socket);
    socket.emitWithAck.mockReset().mockResolvedValue({success: true, data: {...disabled, enabled: true}});
});

function show(status = disabled, role = 'admin') {
    const changed = vi.fn();
    const store = configureStore({reducer: {auth: () => ({user: {role}})}});
    function Feeds() {
        const [current, setCurrent] = useState(status);
        const [observations, setObservations] = useState(true);
        return <FeedSettings status={current} onChanged={next => {setCurrent(next); changed(next);}}
            observationsEnabled={observations} onObservationsChanged={setObservations} locale="en-GB" timezone="UTC" />;
    }
    render(<Provider store={store}><Feeds /></Provider>);
    return changed;
}

it('opens both feed controls from the gear button and toggles observations without consent', async () => {
    const user = userEvent.setup();
    show();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    const settings = screen.getByRole('dialog', {name: 'Calendar feeds'});
    const observations = within(settings).getByRole('switch', {name: 'Local observations'});
    expect(observations).toBeChecked();
    expect(within(settings).getByRole('switch', {name: 'Satellite announcements'})).not.toBeChecked();
    await user.click(observations);
    expect(observations).not.toBeChecked();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(socket.emitWithAck).not.toHaveBeenCalled();
});

it('requires explicit acceptance before saving global opt-in', async () => {
    const user = userEvent.setup();
    const changed = show();
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    const settings = screen.getByRole('dialog', {name: 'Calendar feeds'});
    expect(screen.getByRole('switch', {name: 'Satellite announcements'})).not.toBeChecked();
    await user.click(screen.getByRole('switch', {name: 'Satellite announcements'}));
    const dialog = screen.getByRole('dialog', {name: 'GS Control announcements'});
    expect(screen.getAllByRole('dialog', {hidden: true})).toHaveLength(2);
    expect(settings.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(within(dialog).getByText(/every six hours/)).toBeVisible();
    expect(within(dialog).getByText(/public IP address/)).toBeVisible();
    const enable = within(dialog).getByRole('button', {name: 'Agree and enable'});
    expect(enable).toBeDisabled();
    expect(socket.emitWithAck).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(enable);
    await waitFor(() => expect(changed).toHaveBeenCalledWith(expect.objectContaining({enabled: true})));
    expect(socket.emitWithAck).toHaveBeenCalledWith('api.call', {
        cmd: 'calendar.external.update', data: {enabled: true, terms_version: 'events-1'},
    });
    await waitFor(() => expect(screen.queryByRole('dialog', {name: 'GS Control announcements'})).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', {name: 'Calendar feeds'})).toBeVisible();
    expect(screen.getByRole('switch', {name: 'Satellite announcements'})).toBeChecked();
});

it('closing the explanation leaves the service off without requests', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    await user.click(screen.getByRole('switch', {name: 'Satellite announcements'}));
    await user.click(within(screen.getByRole('dialog')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', {name: 'Close'}));
    await waitFor(() => expect(screen.queryByRole('dialog', {name: 'GS Control announcements'})).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', {name: 'Calendar feeds'})).toBeVisible();
    expect(socket.emitWithAck).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', {name: 'Satellite announcements'})).not.toBeChecked();
    await user.click(screen.getByRole('switch', {name: 'Satellite announcements'}));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', {name: 'GS Control announcements'})).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', {name: 'Calendar feeds'})).toBeVisible();
    expect(socket.emitWithAck).not.toHaveBeenCalled();
});

it('keeps acceptance open and the switch off when saving fails', async () => {
    socket.emitWithAck.mockResolvedValue({success: false});
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

it('disabling is global and needs no new consent', async () => {
    socket.emitWithAck.mockResolvedValue({success: true, data: disabled});
    const user = userEvent.setup();
    const changed = show({...disabled, enabled: true});
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    await user.click(screen.getByRole('switch', {name: 'Satellite announcements'}));
    await waitFor(() => expect(changed).toHaveBeenCalledWith(disabled));
    expect(socket.emitWithAck).toHaveBeenCalledWith('api.call', {
        cmd: 'calendar.external.update', data: {enabled: false},
    });
    expect(screen.getByRole('dialog', {name: 'Calendar feeds'})).toBeVisible();
    expect(screen.queryByRole('dialog', {name: 'GS Control announcements'})).not.toBeInTheDocument();
    expect(screen.getByRole('switch', {name: 'Satellite announcements'})).not.toBeChecked();
});

it('operators can read the disclosure and global state but cannot change it', async () => {
    const user = userEvent.setup();
    show({...disabled, enabled: true}, 'operator');
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    expect(screen.getByRole('switch', {name: 'Satellite announcements'})).toBeChecked();
    expect(screen.getByRole('switch', {name: 'Satellite announcements'})).toBeDisabled();
    expect(screen.getByRole('switch', {name: 'Local observations'})).toBeEnabled();
    await user.click(screen.getByRole('button', {name: 'About this service'}));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Agree and enable'})).not.toBeInTheDocument();
    expect(socket.emitWithAck).not.toHaveBeenCalled();
});

it('shows stale cache status inside feed settings', async () => {
    const user = userEvent.setup();
    show({...disabled, enabled: true, error: 'service_unavailable'});
    await user.click(screen.getByRole('button', {name: 'Calendar feeds'}));
    expect(screen.getByRole('status')).toHaveTextContent('Previously cached events may be outdated');
});
