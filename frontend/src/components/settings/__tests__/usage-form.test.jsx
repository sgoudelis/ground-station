import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import settings from '../../../i18n/locales/en/settings.json';
import AppSettingsForm from '../app-settings-form.jsx';

const { socket, toast } = vi.hoisted(() => ({
    socket: { connected: true, emit: vi.fn(), timeout: vi.fn(), emitWithAck: vi.fn(), on: vi.fn(), off: vi.fn() },
    toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('../../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('../../../utils/toast-with-timestamp.jsx', () => ({ toast }));
const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { settings } }, interpolation: { escapeValue: false } });

let storedUsage;
let storedHost;
const config = () => ({
    config_path: '/tmp/app_config.json',
    fields: [{ key: 'host', value_type: 'string', default: '0.0.0.0', description: 'Backend host.', apply_mode: 'hot' }],
    values: { host: storedHost },
});
const renderForm = () => render(
    <MemoryRouter><I18nextProvider i18n={i18n}><AppSettingsForm /></I18nextProvider></MemoryRouter>,
);
const saveButton = () => screen.getByRole('button', { name: 'Save Settings' });
const configUpdates = () => socket.emit.mock.calls.filter(([, request]) => request.cmd === 'update-app-config');
const usageUpdates = () => socket.emitWithAck.mock.calls.filter(([, request]) => request.cmd === 'usage.update');
const loadForm = async () => {
    renderForm();
    const choice = await screen.findByRole('checkbox', { name: 'Anonymous usage ping' });
    await waitFor(() => expect(choice).toBeEnabled());
    return choice;
};

describe('activity sharing with the General page actions', () => {
    beforeEach(() => {
        storedUsage = false;
        storedHost = '0.0.0.0';
        socket.connected = true;
        socket.timeout.mockReturnValue(socket);
        socket.on.mockReset();
        socket.off.mockReset();
        toast.success.mockReset();
        toast.error.mockReset();
        socket.emit.mockReset().mockImplementation((_event, { cmd, data }, acknowledge) => {
            if (cmd === 'get-app-config') {
                acknowledge({ success: true, data: config() });
            } else if (cmd === 'update-app-config') {
                storedHost = data.values.host;
                acknowledge({ success: true, data: { ...config(), changed_keys: ['host'], changed_hot_keys: ['host'] } });
            }
        });
        socket.emitWithAck.mockReset().mockImplementation(async (_event, { cmd, data }) => {
            if (cmd === 'usage.update') storedUsage = data.enabled;
            return { success: true, data: { enabled: storedUsage, storage_error: false } };
        });
    });

    it('saves a changed checkbox only through the page button and never writes app config', async () => {
        const choice = await loadForm();
        expect(choice).not.toBeChecked();
        expect(saveButton()).toBeDisabled();
        expect(screen.getByText(settings.usage.info)).toBeInTheDocument();
        expect(screen.queryByText(settings.usage.help)).not.toBeInTheDocument();
        expect(screen.queryByText(settings.usage.privacy)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save activity preferences' })).not.toBeInTheDocument();
        fireEvent.click(choice);
        expect(saveButton()).toBeEnabled();
        expect(usageUpdates()).toHaveLength(0);
        expect(configUpdates()).toHaveLength(0);
        fireEvent.click(saveButton());
        await waitFor(() => expect(saveButton()).toBeDisabled());
        expect(usageUpdates()).toEqual([['api.call', { cmd: 'usage.update', data: { enabled: true } }]]);
        expect(configUpdates()).toHaveLength(0);
        expect(toast.success).toHaveBeenCalledWith(settings.app_settings.save_success);
    });

    it('saves turning activity sharing off with the page button', async () => {
        storedUsage = true;
        const choice = await loadForm();
        expect(choice).toBeChecked();
        fireEvent.click(choice);
        fireEvent.click(saveButton());
        await waitFor(() => expect(saveButton()).toBeDisabled());
        expect(usageUpdates()[0][1].data).toEqual({ enabled: false });
        expect(configUpdates()).toHaveLength(0);
    });

    it('uses separate API payloads when configuration and activity both change', async () => {
        const choice = await loadForm();
        fireEvent.change(screen.getByLabelText('Host'), { target: { value: '127.0.0.1' } });
        fireEvent.click(choice);
        fireEvent.click(saveButton());
        await waitFor(() => expect(saveButton()).toBeDisabled());
        expect(configUpdates()).toHaveLength(1);
        expect(configUpdates()[0][1]).toEqual({ cmd: 'update-app-config', data: { values: { host: '127.0.0.1' } } });
        expect(usageUpdates()[0][1]).toEqual({ cmd: 'usage.update', data: { enabled: true } });
    });

    it('resets both drafts without saving either store', async () => {
        const choice = await loadForm();
        fireEvent.change(screen.getByLabelText('Host'), { target: { value: '127.0.0.1' } });
        fireEvent.click(choice);
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        expect(choice).not.toBeChecked();
        expect(screen.getByLabelText('Host')).toHaveValue('0.0.0.0');
        expect(saveButton()).toBeDisabled();
        expect(configUpdates()).toHaveLength(0);
        expect(usageUpdates()).toHaveLength(0);
    });

    it('reloads both stored values with the page Reload action', async () => {
        const choice = await loadForm();
        storedUsage = true;
        storedHost = '127.0.0.1';
        fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
        await waitFor(() => expect(choice).toBeChecked());
        expect(screen.getByLabelText('Host')).toHaveValue('127.0.0.1');
        expect(saveButton()).toBeDisabled();
        expect(configUpdates()).toHaveLength(0);
        expect(usageUpdates()).toHaveLength(0);
        expect(socket.emitWithAck.mock.calls.filter(([, request]) => request.cmd === 'usage.get')).toHaveLength(2);
    });

    it('keeps the checkbox dirty after a failed save and allows resetting it', async () => {
        const choice = await loadForm();
        socket.emitWithAck.mockResolvedValueOnce({ success: false, error: 'Could not save.' });
        fireEvent.click(choice);
        fireEvent.click(saveButton());
        await screen.findByText('Could not save.');
        expect(choice).toBeChecked();
        expect(saveButton()).toBeEnabled();
        expect(toast.success).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        expect(choice).not.toBeChecked();
        expect(saveButton()).toBeDisabled();
        expect(screen.queryByText('Could not save.')).not.toBeInTheDocument();
    });

    it('does not save activity if runtime configuration fails validation', async () => {
        const choice = await loadForm();
        socket.emit.mockImplementationOnce((_event, _request, acknowledge) => acknowledge({
            success: false, error: 'Invalid host.', data: { validation_errors: { host: 'Invalid host.' } },
        }));
        fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'invalid' } });
        fireEvent.click(choice);
        fireEvent.click(saveButton());
        await screen.findByText('Invalid host.');
        expect(usageUpdates()).toHaveLength(0);
        expect(choice).toBeChecked();
        expect(saveButton()).toBeEnabled();
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('retries only activity after the runtime config saved successfully', async () => {
        const choice = await loadForm();
        socket.emitWithAck.mockResolvedValueOnce({ success: false, error: 'Activity save failed.' });
        fireEvent.change(screen.getByLabelText('Host'), { target: { value: '127.0.0.1' } });
        fireEvent.click(choice);
        fireEvent.click(saveButton());
        await screen.findByText('Activity save failed.');
        expect(screen.getByLabelText('Host')).toHaveValue('127.0.0.1');
        expect(configUpdates()).toHaveLength(1);
        expect(saveButton()).toBeEnabled();
        expect(toast.success).not.toHaveBeenCalled();
        fireEvent.click(saveButton());
        await waitFor(() => expect(saveButton()).toBeDisabled());
        expect(configUpdates()).toHaveLength(1);
        expect(usageUpdates()).toHaveLength(2);
        expect(toast.success).toHaveBeenCalledTimes(1);
    });

    it('keeps ordinary config editable when activity storage is corrupt', async () => {
        socket.emitWithAck.mockResolvedValueOnce({ success: true, data: { enabled: false, storage_error: true } });
        renderForm();
        await screen.findByText(/repair local storage/i);
        expect(screen.getByRole('checkbox', { name: 'Anonymous usage ping' })).toBeDisabled();
        expect(saveButton()).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Host'), { target: { value: '127.0.0.1' } });
        fireEvent.click(saveButton());
        await waitFor(() => expect(saveButton()).toBeDisabled());
        expect(configUpdates()).toHaveLength(1);
        expect(usageUpdates()).toHaveLength(0);
    });
});
