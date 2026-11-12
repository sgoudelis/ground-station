import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import settings from '../../../i18n/locales/en/settings.json';
import FeedbackForm from '../feedback-form.jsx';

const { socket } = vi.hoisted(() => ({
    socket: { connected: true, timeout: vi.fn(), emitWithAck: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('../../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { settings } }, interpolation: { escapeValue: false } });

let state;
const renderForm = () => render(<I18nextProvider i18n={i18n}><FeedbackForm /></I18nextProvider>);
const submissions = () => socket.emitWithAck.mock.calls.filter(([, request]) => request.cmd === 'feedback.update');

describe('feedback preferences', () => {
    beforeEach(() => {
        state = {
            enabled: false, environment: 'unknown', deletion_pending: false,
            blocked: false, error: null, storage_error: false, last_success_at: null,
            installation_id: null,
            sample: { installation_id: '<random UUID generated on opt-in>', deployment: { type: 'native', environment: 'unknown' } },
        };
        socket.connected = true;
        socket.on.mockReset();
        socket.off.mockReset();
        socket.timeout.mockReturnValue(socket);
        socket.emitWithAck.mockReset().mockImplementation(async (_event, request) => {
            if (request.cmd === 'feedback.update') state = { ...state, ...request.data, accepted_notice_version: request.data.consent_notice_version, needs_consent_review: false };
            return { success: true, data: { ...state } };
        });
    });

    it('defaults off, fully discloses reporting, and never saves merely by opening or toggling', async () => {
        renderForm();
        const census = await screen.findByRole('switch', { name: 'Share installation census' });
        await waitFor(() => expect(census).toBeEnabled());
        expect(census).not.toBeChecked();
        expect(screen.queryByRole('combobox', { name: 'Installation environment' })).not.toBeInTheDocument();
        expect(screen.queryByRole('switch', { name: /share performance metrics/i })).not.toBeInTheDocument();
        expect(screen.getByText(/pseudonymous, not fully anonymous/i)).toBeInTheDocument();
        expect(screen.getByText('CPU').closest('li')).toHaveTextContent('CPU Processor brand, model and the core count reported by your system.');
        expect(screen.getByText('Network').closest('li')).toHaveTextContent('We use and store only the public IP address');
        expect(screen.getByText(/seven days after the last report/i)).toBeInTheDocument();
        expect(screen.getByRole('list', { name: 'What gets reported' })).toBeInTheDocument();
        expect(screen.getByRole('list', { name: 'What stays on your station' })).toBeInTheDocument();
        expect(screen.getByText('Station identity').closest('li')).toHaveTextContent('Your station name and callsign.');
        expect(submissions()).toHaveLength(0);
        fireEvent.click(census);
        expect(submissions()).toHaveLength(0);
        expect(screen.getByText('Census off')).toBeInTheDocument();
        expect(screen.getByText('Unsaved changes — use Save to apply your choice.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save feedback preferences' }));
        await screen.findByText('Census enabled');
        expect(screen.queryByText('Your feedback preferences have been saved.')).not.toBeInTheDocument();
        expect(submissions()[0][1].data).toEqual({ enabled: true, consent_notice_version: 'census-2' });
    });

    it('allows withdrawal without displaying a pending-deletion alert', async () => {
        state.enabled = true;
        socket.emitWithAck.mockImplementation(async (_event, request) => {
            if (request.cmd === 'feedback.update') state = { ...state, ...request.data, deletion_pending: true };
            return { success: true, data: { ...state } };
        });
        renderForm();
        await screen.findByText('Census enabled');
        fireEvent.click(screen.getByRole('switch', { name: 'Share installation census' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save feedback preferences' }));
        await screen.findByText('Census off');
        expect(screen.queryByText(/Deletion of the previously stored census and IP is pending/i)).not.toBeInTheDocument();
        expect(submissions()[0][1].data.enabled).toBe(false);
    });

    it('requires an explicit save to renew country inference and updates the payload preview', async () => {
        state.enabled = true;
        state.accepted_notice_version = 'census-1';
        state.needs_consent_review = true;
        state.sample.consent_notice_version = 'census-1';
        const { container } = renderForm();
        const save = await screen.findByRole('button', { name: 'Save feedback preferences' });
        await waitFor(() => expect(save).toBeEnabled());
        expect(screen.queryByText(/Your existing census consent remains active without country inference/)).not.toBeInTheDocument();
        expect(screen.queryByText(/^Current disclosure:/)).not.toBeInTheDocument();
        expect(screen.queryByText(/^Saved consent:/)).not.toBeInTheDocument();
        expect(screen.getByText('JSON · generated locally')).toBeInTheDocument();
        expect(submissions()).toHaveLength(0);
        expect(JSON.parse(container.querySelector('pre').textContent).consent_notice_version).toBe('census-1');
        fireEvent.click(save);
        await waitFor(() => expect(JSON.parse(container.querySelector('pre').textContent).consent_notice_version).toBe('census-2'));
        expect(submissions()[0][1].data).toEqual({ enabled: true, consent_notice_version: 'census-2' });
        expect(JSON.parse(container.querySelector('pre').textContent).consent_notice_version).toBe('census-2');
        expect(screen.queryByText(/Your existing census consent remains active without country inference/)).not.toBeInTheDocument();
    });

    it('keeps unsaved consent visible when persistence fails', async () => {
        socket.emitWithAck.mockImplementation(async (_event, request) => request.cmd === 'feedback.update'
            ? { success: false, error: 'Could not save consent.' }
            : { success: true, data: { ...state } });
        renderForm();
        const census = await screen.findByRole('switch', { name: 'Share installation census' });
        await waitFor(() => expect(census).toBeEnabled());
        fireEvent.click(census);
        fireEvent.click(screen.getByRole('button', { name: 'Save feedback preferences' }));
        await screen.findByText('Could not save consent.');
        expect(screen.getByText('Census off')).toBeInTheDocument();
        expect(census).toBeChecked();
        expect(screen.queryByText('Your feedback preferences have been saved.')).not.toBeInTheDocument();
    });

    it('keeps the backend environment in the payload preview without showing a separate setting', async () => {
        state.environment = 'development';
        state.sample.deployment.environment = 'development';
        const { container } = renderForm();
        const census = await screen.findByRole('switch', { name: 'Share installation census' });
        await waitFor(() => expect(census).toBeEnabled());
        expect(screen.queryByText('Installation environment')).not.toBeInTheDocument();
        expect(screen.queryByText('Development')).not.toBeInTheDocument();
        expect(JSON.parse(container.querySelector('pre').textContent).deployment.environment).toBe('development');
        fireEvent.click(census);
        fireEvent.click(screen.getByRole('button', { name: 'Save feedback preferences' }));
        await screen.findByText('Census enabled');
        expect(submissions()[0][1].data).not.toHaveProperty('environment');
    });

    it('shows storage failures and prevents claiming consent was saved', async () => {
        state.storage_error = true;
        renderForm();
        await screen.findByText(/Feedback storage is unreadable/i);
        expect(screen.getByRole('switch', { name: 'Share installation census' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Save feedback preferences' })).toBeDisabled();
    });

    it('requires a backend connection to change settings', async () => {
        socket.connected = false;
        renderForm();
        await screen.findByText('A backend connection is required to manage feedback.');
        expect(screen.getByRole('button', { name: 'Save feedback preferences' })).toBeDisabled();
        expect(submissions()).toHaveLength(0);
    });
});
