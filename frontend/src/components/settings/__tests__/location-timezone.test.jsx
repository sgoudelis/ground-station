import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import settings from '../../../i18n/locales/en/settings.json';
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
await i18n.init({ lng: 'en', resources: { en: { settings } }, interpolation: { escapeValue: false } });

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
            return { success: true, data: { state: 'running' } };
        });
    });

    it('shows the detected zone and submits the user override', async () => {
        renderWizard();
        advanceToIdentity();
        const selector = screen.getByRole('combobox', { name: 'Time Zone' });
        await waitFor(() => expect(selector).toHaveValue('Europe/Amsterdam'));
        fireEvent.change(selector, { target: { value: 'Asia/Kathmandu' } });
        fireEvent.click(await screen.findByRole('option', { name: 'Asia/Kathmandu' }));
        expect(selector).toHaveValue('Asia/Kathmandu');
        advanceFromIdentityToReview();
        expect(screen.queryByRole('combobox', { name: 'Time Zone' })).not.toBeInTheDocument();
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
        const selector = screen.getByRole('combobox', { name: 'Time Zone' });
        fireEvent.change(selector, { target: { value: 'UTC' } });
        fireEvent.click(await screen.findByRole('option', { name: 'UTC' }));
        advanceFromIdentityToReview();
        expect(screen.getByRole('button', { name: 'Save location' })).toBeEnabled();
    }, WIZARD_TEST_TIMEOUT_MS);
});
