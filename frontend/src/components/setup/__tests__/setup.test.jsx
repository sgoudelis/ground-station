import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n/config.js';
import { languageOptions } from '../../../i18n/languages.js';
import { getAvailableThemesWithMetadata } from '../../../themes/theme-configs.js';
import { capsLabel } from '../../../utils/greekcaps.js';
import { setupTheme } from '../../../theme.js';
import preferencesReducer from '../../settings/preferences-slice.jsx';
import SetupWizard from '../setup.jsx';

const { socket } = vi.hoisted(() => ({
    socket: { connected: true, emitWithAck: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('../../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('../../../utils/toast-with-timestamp.jsx', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const tr = (key) => i18n.t(key, { ns: 'settings' });
// Buttons render through <CapsButton>, which capitalises Greek labels in JS (src/utils/greekcaps.js),
// so accessible names in el are tonos-free capitals while form labels stay as authored.
const btn = (key) => capsLabel(tr(key), i18n);
const next = () => fireEvent.click(screen.getByRole('button', { name: btn('location.next') }));
const back = () => fireEvent.click(screen.getByRole('button', { name: btn('location.back') }));
const field = (key) => screen.getByLabelText(new RegExp(`^${tr(key)}\\s*\\*?$`));

const renderWizard = (props = {}) => {
    const store = configureStore({
        reducer: {
            preferences: preferencesReducer,
            auth: () => ({ loadingAction: false, error: null }),
            syncSatellite: () => ({ syncState: null, synchronizing: false, error: null }),
        },
    });
    render(
        <Provider store={store}>
            <ThemeProvider theme={setupTheme('light')}>
                <React.Suspense fallback="Loading">
                    <SetupWizard
                        wizardRequireAdminSetup
                        hasLocation
                        setupTimezone="Europe/Athens"
                        setupLocationPayload={{ lat: 37.9838, lon: 23.7275, name: 'home' }}
                        stationIdentitySection={<p>Station identity fields</p>}
                        wizardMapSection={<p>Station map</p>}
                        {...props}
                    />
                </React.Suspense>
            </ThemeProvider>
        </Provider>
    );
    return store;
};

const chooseLanguage = async (name) => {
    fireEvent.mouseDown(screen.getByRole('combobox', { name: tr('preferences.language') }));
    expect(screen.getAllByRole('option').map((option) => option.textContent))
        .toEqual(languageOptions.map((option) => option.name));
    fireEvent.click(screen.getByRole('option', { name }));
    await waitFor(() => expect(i18n.resolvedLanguage).toBe(
        languageOptions.find((option) => option.name === name).value.split('_')[0]
    ));
};

const chooseTheme = (name) => {
    fireEvent.mouseDown(screen.getByRole('combobox', { name: tr('preferences.theme') }));
    expect(screen.getAllByRole('option').map((option) => option.textContent))
        .toEqual(getAvailableThemesWithMetadata().map((option) => option.name));
    fireEvent.click(screen.getByRole('option', { name, exact: true }));
};

describe('Setup wizard language and theme selection', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        socket.emitWithAck.mockResolvedValue({ success: true, data: { state: 'idle' } });
        await i18n.changeLanguage('en');
    });

    it('previews language and theme preferences without losing wizard drafts', async () => {
        const store = renderWizard();
        expect(screen.getByRole('heading', { name: 'Choose your language and theme' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
        expect(screen.queryByLabelText(/^Username/)).not.toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: tr('preferences.theme') })).toHaveTextContent('Dark');
        chooseTheme('Night (OLED)');
        expect(store.getState().preferences.userPreferences).toContainEqual(
            expect.objectContaining({ name: 'theme', value: 'night' })
        );

        await chooseLanguage('Ελληνικά');
        expect(await screen.findByRole('heading', { name: 'Επιλέξτε γλώσσα και θέμα' })).toBeVisible();
        expect(document.documentElement).toHaveAttribute('lang', 'el');
        expect(store.getState().preferences.userPreferences).toContainEqual(
            expect.objectContaining({ name: 'language', value: 'el_GR' })
        );
        expect(screen.getByRole('button', { name: btn('location.next') })).toBeEnabled();

        next();
        fireEvent.change(field('setup.username'), { target: { value: 'wizard-admin' } });
        back();
        expect(screen.getByRole('combobox', { name: tr('preferences.language') })).toHaveTextContent('Ελληνικά');
        expect(screen.getByRole('combobox', { name: tr('preferences.theme') })).toHaveTextContent('Night (OLED)');
        await chooseLanguage('English');
        expect(await screen.findByRole('heading', { name: 'Choose your language and theme' })).toBeVisible();
        chooseTheme('Light');
        expect(store.getState().preferences.userPreferences).toContainEqual(
            expect.objectContaining({ name: 'theme', value: 'light' })
        );
        expect(socket.emitWithAck.mock.calls.some(([, request]) =>
            ['setup.finalize', 'update-preferences'].includes(request.cmd)
        )).toBe(false);
        next();
        expect(field('setup.username')).toHaveValue('wizard-admin');
    });

    it('submits the chosen language and actual theme value together when finalizing', async () => {
        renderWizard();
        await chooseLanguage('Ελληνικά');
        chooseTheme('Auto (System)');
        next();
        fireEvent.change(field('setup.username'), { target: { value: 'wizard-admin' } });
        fireEvent.change(field('setup.password'), { target: { value: 'Password123!' } });
        fireEvent.change(field('setup.confirm_password'), { target: { value: 'Password123!' } });
        next();
        expect(screen.getByText('Station identity fields')).toBeVisible();
        next();
        expect(screen.getByText('Station map')).toBeVisible();
        next();
        // This one is an IconButton labelled by aria-label, not by capped child text, so it keeps
        // the authored mixed case.
        fireEvent.click(screen.getByRole('button', { name: tr('location.save_location') }));

        await waitFor(() => expect(socket.emitWithAck).toHaveBeenCalledWith('api.call', {
            cmd: 'setup.finalize',
            data: expect.objectContaining({ language: 'el_GR', theme: 'auto', timezone: 'Europe/Athens', usage: { enabled: true } }),
        }));
    });

    it('keeps the location-only wizard on its existing first step', () => {
        renderWizard({ wizardRequireAdminSetup: false });
        expect(screen.getByText('Station identity fields')).toBeVisible();
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });
});
