import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

let socketValue = null;
const navigateMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('react-router', async () => {
    const actual = await vi.importActual('react-router');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

vi.mock('../../common/socket.jsx', () => ({
    useSocket: () => ({ socket: socketValue }),
}));

vi.mock('../../../utils/toast-with-timestamp.jsx', () => ({
    toast: {
        success: (...args) => toastSuccessMock(...args),
        error: (...args) => toastErrorMock(...args),
    },
}));

// Injected by tests to verify translated values win and missing ones fall back to defaultValue.
let translations = {};

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, options) => translations[key] ?? options?.defaultValue ?? key,
    }),
}));

import AppSettingsForm from '../app-settings-form.jsx';

function buildPayload({
    host = '0.0.0.0',
    port = 5000,
    hostSource = 'file',
    hostLocked = false,
    portLocked = false,
    portApplyMode = 'restart_required',
} = {}) {
    return {
        config_path: '/tmp/app_config.json',
        fields: [
            {
                key: 'host',
                value_type: 'string',
                default: '0.0.0.0',
                description: 'Host interface used by the backend web server.',
                apply_mode: 'restart_required',
                minimum: null,
                maximum: null,
                choices: null,
                sensitive: false,
                cli_flag: '--host',
            },
            {
                key: 'port',
                value_type: 'integer',
                default: 5000,
                description: 'TCP port used by the backend web server.',
                apply_mode: portApplyMode,
                minimum: 1,
                maximum: 65535,
                choices: null,
                sensitive: false,
                cli_flag: '--port',
            },
        ],
        values: {
            host,
            port,
        },
        source: {
            host: hostSource,
            port: portLocked ? 'cli' : 'file',
        },
        locked: {
            host: hostLocked,
            port: portLocked,
        },
        defined_in_file: {
            host: true,
            port: true,
        },
        overridden_by_cli: [hostLocked && 'host', portLocked && 'port'].filter(Boolean),
    };
}

describe('app-settings-form', () => {
    beforeEach(() => {
        socketValue = null;
        translations = {};
        navigateMock.mockReset();
        toastSuccessMock.mockReset();
        toastErrorMock.mockReset();
    });

    it('loads and saves settings, then shows restart-required state', async () => {
        const initialPayload = buildPayload();
        const updatedPayload = {
            ...buildPayload({ host: '127.0.0.1' }),
            changed_keys: ['host'],
            changed_hot_keys: [],
            changed_restart_keys: ['host'],
            restart_required: true,
        };

        socketValue = {
            emit: vi.fn((event, payload, callback) => {
                if (event === 'api.call' && payload?.cmd === 'get-app-config') {
                    callback({ success: true, data: initialPayload });
                    return;
                }
                if (event === 'api.call' && payload?.cmd === 'update-app-config') {
                    callback({ success: true, data: updatedPayload });
                }
            }),
        };

        render(<AppSettingsForm />);

        await screen.findByLabelText('Host');
        expect(screen.getByRole('heading', { name: 'Application Settings' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
        expect(screen.getByText('2 settings')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Host'), {
            target: { value: '127.0.0.1' },
        });
        expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

        await screen.findByRole('button', { name: 'Open Maintenance' });

        const submissionCall = socketValue.emit.mock.calls.find(
            (call) => call[0] === 'api.call' && call[1]?.cmd === 'update-app-config'
        );
        expect(submissionCall).toBeTruthy();
        expect(submissionCall[1]).toEqual({
            cmd: 'update-app-config',
            data: { values: { host: '127.0.0.1' } },
        });
        expect(toastSuccessMock).toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Open Maintenance' }));
        expect(navigateMock).toHaveBeenCalledWith('/admin/system/maintenance/system');
    });

    it('keeps CLI-controlled backend ports read-only', async () => {
        socketValue = {
            emit: vi.fn((event, payload, callback) => {
                if (event === 'api.call' && payload?.cmd === 'get-app-config') {
                    callback({ success: true, data: buildPayload({ port: 7001, portLocked: true }) });
                }
            }),
        };

        render(<AppSettingsForm />);

        expect(await screen.findByLabelText('Port')).toBeDisabled();
        expect(screen.getByLabelText('Host')).not.toBeDisabled();
        expect(screen.getByText('Set by startup command (read-only)')).toBeInTheDocument();
        expect(socketValue.emit).not.toHaveBeenCalledWith(
            'api.call',
            expect.objectContaining({ cmd: 'update-app-config' }),
            expect.any(Function)
        );
    });

    it('renders backend validation errors when save fails', async () => {
        const initialPayload = buildPayload();

        socketValue = {
            emit: vi.fn((event, payload, callback) => {
                if (event === 'api.call' && payload?.cmd === 'get-app-config') {
                    callback({ success: true, data: initialPayload });
                    return;
                }
                if (event === 'api.call' && payload?.cmd === 'update-app-config') {
                    callback({
                        success: false,
                        error: 'One or more settings are invalid',
                        data: {
                            validation_errors: {
                                port: 'Value must be <= 65535',
                            },
                        },
                    });
                }
            }),
        };

        render(<AppSettingsForm />);

        await screen.findByLabelText('Port');

        fireEvent.change(screen.getByLabelText('Port'), {
            target: { value: '99999' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

        await waitFor(() => {
            expect(screen.getByText('Value must be <= 65535')).toBeInTheDocument();
        });
        expect(toastErrorMock).toHaveBeenCalledWith('One or more settings are invalid');
    });

    it('groups fields by subsystem in section blocks', async () => {
        const initialPayload = buildPayload({ portApplyMode: 'hot' });

        socketValue = {
            emit: vi.fn((event, payload, callback) => {
                if (event === 'api.call' && payload?.cmd === 'get-app-config') {
                    callback({ success: true, data: initialPayload });
                }
            }),
        };

        render(<AppSettingsForm />);

        await screen.findByLabelText('Host');
        expect(screen.getByRole('heading', { name: 'Network' })).toBeInTheDocument();
        expect(screen.getAllByText('Saved').length).toBeGreaterThan(0);
    });
    it('translates backend-provided field descriptions and falls back to the backend text', async () => {
        // The backend schema only provides an English description, with no i18n field.
        translations = { 'app_settings.field_host': 'Translated host description.' };
        socketValue = {
            emit: vi.fn((event, payload, callback) => {
                if (event === 'api.call' && payload?.cmd === 'get-app-config') {
                    callback({ success: true, data: buildPayload() });
                }
            }),
        };

        render(<AppSettingsForm />);

        // Present in the locale bundle -> renders the translation.
        expect(await screen.findByText('Translated host description.')).toBeInTheDocument();
        // Missing from the locale bundle -> falls back to the backend text, not a raw key.
        expect(screen.getByText('TCP port used by the backend web server.')).toBeInTheDocument();
    });
});
