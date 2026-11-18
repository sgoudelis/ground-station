import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, expect, it, vi} from 'vitest';
import '../../i18n/config.js';
import ExternalEvents from './external-events.jsx';

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
    render(<Provider store={store}><ExternalEvents status={status} onChanged={changed} locale="en-GB" timezone="UTC" /></Provider>);
    return changed;
}

it('requires explicit acceptance before saving global opt-in', async () => {
    const user = userEvent.setup();
    const changed = show();
    expect(screen.getByRole('switch')).not.toBeChecked();
    await user.click(screen.getByRole('switch'));
    const dialog = screen.getByRole('dialog');
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
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('closing the explanation leaves the service off without requests', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('switch'));
    await user.click(within(screen.getByRole('dialog')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', {name: 'Close'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(socket.emitWithAck).not.toHaveBeenCalled();
    expect(screen.getByRole('switch')).not.toBeChecked();
    await user.click(screen.getByRole('switch'));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
});

it('keeps acceptance open and the switch off when saving fails', async () => {
    socket.emitWithAck.mockResolvedValue({success: false});
    const user = userEvent.setup();
    const changed = show();
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', {name: 'Agree and enable'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', {hidden: true})).not.toBeChecked();
});

it('disabling is global and needs no new consent', async () => {
    socket.emitWithAck.mockResolvedValue({success: true, data: disabled});
    const user = userEvent.setup();
    const changed = show({...disabled, enabled: true});
    await user.click(screen.getByRole('switch'));
    await waitFor(() => expect(changed).toHaveBeenCalledWith(disabled));
    expect(socket.emitWithAck).toHaveBeenCalledWith('api.call', {
        cmd: 'calendar.external.update', data: {enabled: false},
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('operators can read the disclosure and global state but cannot change it', async () => {
    const user = userEvent.setup();
    show({...disabled, enabled: true}, 'operator');
    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.getByRole('switch')).toBeDisabled();
    await user.click(screen.getByRole('button', {name: 'About this service'}));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Agree and enable'})).not.toBeInTheDocument();
    expect(socket.emitWithAck).not.toHaveBeenCalled();
});

it('shows stale cache status', () => {
    show({...disabled, enabled: true, error: 'service_unavailable'});
    expect(screen.getByRole('status')).toHaveTextContent('Previously cached events may be outdated');
});
