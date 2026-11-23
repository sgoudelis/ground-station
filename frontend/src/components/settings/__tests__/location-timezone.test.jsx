import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import settings from '../../../i18n/locales/en/settings.json';
import common from '../../../i18n/locales/en/common.json';
import locationReducer from '../location-slice.jsx';
import LocationPage from '../location-form.jsx';

const { socket } = vi.hoisted(() => ({
    socket: { connected: true, timeout: vi.fn(), emitWithAck: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
// The full coverage job instruments the large setup wizard and runs it beside
// every frontend test. Give these UI-flow checks room for that CI overhead.
const WIZARD_TEST_TIMEOUT_MS = 20000;
vi.mock('../../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('../../../utils/toast-with-timestamp.jsx', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../common/common.jsx', () => ({ getMaidenhead: () => 'JO22' }));
vi.mock('../../common/maplibre.js', () => ({ maplibregl: {} }));
vi.mock('react-map-gl/maplibre', () => ({
    default: ({ children }) => <div>{children}</div>,
    Layer: () => null, Marker: () => null, Source: () => null,
}));

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { settings, common } }, interpolation: { escapeValue: false } });

const renderWizard = () => {
    const store = configureStore({
        reducer: {
            location: locationReducer,
            preferences: () => ({ preferences: [{ name: 'timezone', value: 'Europe/Athens' }] }),
            auth: () => ({ loadingAction: false, error: null }),
            syncSatellite: () => ({ syncState: null, synchronizing: false, error: null }),
        },
        preloadedState: {
            location: {
                ...locationReducer(undefined, { type: '@@INIT' }),
                location: { lat: 52.3676, lon: 4.9041, name: 'home' },
            },
        },
    });
    return render(
        <Provider store={store}>
            <I18nextProvider i18n={i18n}>
                <LocationPage wizardMode wizardRequireAdminSetup />
            </I18nextProvider>
        </Provider>,
    );
};

const advanceToIdentity = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText(/^username/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
};

const advanceFromIdentityToReview = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
};

describe('wizard timezone', () => {
    afterEach(() => vi.unstubAllGlobals());
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ city: 'Amsterdam' }) }));
        socket.timeout.mockReturnValue(socket);
        socket.emitWithAck.mockReset().mockImplementation(async (_event, payload) => {
            if (payload.cmd === 'get-location-timezone') {
                return { success: true, data: { timezone: 'Europe/Amsterdam' } };
            }
            if (payload.cmd === 'setup.status') {
                return { success: true, data: { state: 'running' } };
            }
            return { success: true, data: { state: 'running' } };
        });
    });

    it('offers Automatic, restores detection, and submits a manual override', async () => {
        renderWizard();
        advanceToIdentity();
        const selector = screen.getByRole('combobox', { name: 'Timezone' });
        expect(selector).toHaveTextContent('Automatic');
        fireEvent.mouseDown(selector);
        fireEvent.click(await screen.findByRole('option', { name: 'Asia/Kathmandu' }));
        expect(selector).toHaveTextContent('Asia/Kathmandu');
        fireEvent.mouseDown(selector);
        fireEvent.click(await screen.findByRole('option', { name: 'Automatic' }));
        expect(selector).toHaveTextContent('Automatic');
        advanceFromIdentityToReview();
        expect(await screen.findByText(/^Europe\/Amsterdam \(UTC[+-]\d{2}:\d{2}\)$/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        const restoredSelector = screen.getByRole('combobox', { name: 'Timezone' });
        expect(restoredSelector).toHaveTextContent('Automatic');
        fireEvent.mouseDown(restoredSelector);
        fireEvent.click(await screen.findByRole('option', { name: 'Asia/Kathmandu' }));
        advanceFromIdentityToReview();
        expect(screen.queryByRole('combobox', { name: 'Timezone' })).not.toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: /discover soapysdr/i })).not.toBeInTheDocument();
        expect(screen.getByText('Asia/Kathmandu (UTC+05:45)')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save location' }));
        await waitFor(() => expect(socket.emitWithAck).toHaveBeenCalledWith('api.call', {
            cmd: 'setup.finalize',
            data: expect.objectContaining({ timezone: 'Asia/Kathmandu', location: expect.objectContaining({ lat: 52.3676, lon: 4.9041 }) }),
        }));
        const finalizePayload = socket.emitWithAck.mock.calls.find(([, payload]) => payload.cmd === 'setup.finalize')[1].data;
        expect(finalizePayload).not.toHaveProperty('discover_soapy');
        expect(screen.queryByText('SoapySDR Detection')).not.toBeInTheDocument();
        expect(screen.getByText('Orbital data sync started')).toBeInTheDocument();
        expect(screen.getByText('Asia/Kathmandu (UTC+05:45)')).toBeInTheDocument();
    }, WIZARD_TEST_TIMEOUT_MS);

    it('requires a manual selection if timezone detection fails', async () => {
        socket.emitWithAck.mockResolvedValue({ success: false });
        renderWizard();
        advanceToIdentity();
        advanceFromIdentityToReview();
        const save = screen.getByRole('button', { name: 'Save location' });
        expect(save).toBeDisabled();
        await screen.findByText('Could not detect timezone. Go back to Station Identity and select one.');
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        await screen.findByText('Could not detect timezone. Select one to continue.');
        const selector = screen.getByRole('combobox', { name: 'Timezone' });
        fireEvent.mouseDown(selector);
        fireEvent.click(await screen.findByRole('option', { name: 'UTC' }));
        advanceFromIdentityToReview();
        expect(screen.getByRole('button', { name: 'Save location' })).toBeEnabled();
    }, WIZARD_TEST_TIMEOUT_MS);

    it.each([true, false])('saves the activity choice only at setup finalization (enabled: %s)', async (enabled) => {
        renderWizard();
        advanceToIdentity();
        expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveTextContent('Automatic');
        const activity = screen.getByRole('checkbox', { name: 'Anonymous usage ping' });
        expect(activity).toBeChecked();
        const explanation = 'Sends a ping to help the developer count active Ground Station installations by country. No station or account details are shared.';
        const infoButton = screen.getByRole('button', { name: 'About this option' });
        expect(screen.queryByText(explanation)).not.toBeInTheDocument();
        expect(infoButton).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(infoButton);
        expect(screen.getByText(explanation)).toBeVisible();
        expect(infoButton).toHaveAttribute('aria-expanded', 'true');
        expect(activity).toBeChecked();
        fireEvent.click(infoButton);
        expect(screen.queryByText(explanation)).not.toBeInTheDocument();
        expect(screen.queryByText(/discards the IP/)).not.toBeInTheDocument();
        if (!enabled) fireEvent.click(activity);
        expect(socket.emitWithAck.mock.calls.some(([, request]) => request.cmd === 'usage.update')).toBe(false);
        advanceFromIdentityToReview();
        expect(screen.getByText(enabled ? 'Activity sharing: enabled' : 'Activity sharing: off')).toBeInTheDocument();
        const save = screen.getByRole('button', { name: 'Save location' });
        await waitFor(() => expect(save).toBeEnabled());
        fireEvent.click(save);
        await waitFor(() => expect(socket.emitWithAck).toHaveBeenCalledWith('api.call', {
            cmd: 'setup.finalize',
            data: expect.objectContaining({ usage: { enabled }, timezone: 'Europe/Amsterdam' }),
        }));
        const payload = socket.emitWithAck.mock.calls.find(([, request]) => request.cmd === 'setup.finalize')[1].data;
        expect(payload).not.toHaveProperty('feedback');
    }, WIZARD_TEST_TIMEOUT_MS);
});
