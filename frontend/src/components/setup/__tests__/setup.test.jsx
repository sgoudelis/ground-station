import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n/config.js';
import { languageOptions } from '../../../i18n/languages.js';
import { setupTheme } from '../../../theme.js';
import preferencesReducer from '../../settings/preferences-slice.jsx';
import SetupWizard from '../setup.jsx';

const { socket } = vi.hoisted(() => ({
    socket: { connected: true, emitWithAck: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('../../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('../../../utils/toast-with-timestamp.jsx', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const tr = (key) => i18n.t(key, { ns: 'settings' });
const next = () => fireEvent.click(screen.getByRole('button', { name: tr('location.next') }));
const back = () => fireEvent.click(screen.getByRole('button', { name: tr('location.back') }));
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

describe('Setup wizard language selection', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        socket.emitWithAck.mockResolvedValue({ success: true, data: { state: 'idle' } });
        await i18n.changeLanguage('en');
    });

    it('starts with language selection and applies the choice without losing wizard drafts', async () => {
        const store = renderWizard();
        expect(screen.getByRole('heading', { name: 'Choose your language' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
        expect(screen.queryByLabelText(/^Username/)).not.toBeInTheDocument();

        await chooseLanguage('Ελληνικά');
        expect(await screen.findByRole('heading', { name: 'Επιλέξτε τη γλώσσα σας' })).toBeVisible();
        expect(document.documentElement).toHaveAttribute('lang', 'el');
        expect(store.getState().preferences.userPreferences).toContainEqual(
            expect.objectContaining({ name: 'language', value: 'el_GR' })
        );
        expect(screen.getByRole('button', { name: 'Επόμενο' })).toBeEnabled();

        next();
        fireEvent.change(field('setup.username'), { target: { value: 'wizard-admin' } });
        back();
        expect(screen.getByRole('combobox')).toHaveTextContent('Ελληνικά');
        await chooseLanguage('English');
        expect(await screen.findByRole('heading', { name: 'Choose your language' })).toBeVisible();
        next();
        expect(field('setup.username')).toHaveValue('wizard-admin');
    });

    it('includes the selected language when finalizing the administrator account', async () => {
        renderWizard();
        await chooseLanguage('Ελληνικά');
        next();
        fireEvent.change(field('setup.username'), { target: { value: 'wizard-admin' } });
        fireEvent.change(field('setup.password'), { target: { value: 'Password123!' } });
        fireEvent.change(field('setup.confirm_password'), { target: { value: 'Password123!' } });
        next();
        expect(screen.getByText('Station identity fields')).toBeVisible();
        next();
        expect(screen.getByText('Station map')).toBeVisible();
        next();
        expect(screen.getByRole('heading', { name: tr('feedback.title') })).toBeVisible();
        next();
        fireEvent.click(screen.getByRole('button', { name: tr('location.save_location') }));

        await waitFor(() => expect(socket.emitWithAck).toHaveBeenCalledWith('api.call', {
            cmd: 'setup.finalize',
            data: expect.objectContaining({ language: 'el_GR', timezone: 'Europe/Athens' }),
        }));
    });

    it('keeps the location-only wizard on its existing first step', () => {
        renderWizard({ wizardRequireAdminSetup: false });
        expect(screen.getByText('Station identity fields')).toBeVisible();
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });
});
