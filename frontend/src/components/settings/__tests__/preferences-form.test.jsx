import React from 'react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {ThemeProvider} from '@mui/material/styles';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import '../../../i18n/config.js';
import {setupTheme} from '../../../theme.js';
import preferencesReducer, {setPreference} from '../preferences-slice.jsx';
import PreferencesForm from '../preferences-form.jsx';

const {socket} = vi.hoisted(() => ({socket: {emit: vi.fn()}}));
vi.mock('../../common/socket.jsx', () => ({useSocket: () => ({socket})}));
vi.mock('../../../utils/toast-with-timestamp.jsx', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

describe('CARTO API key preference', () => {
    it('masks, reveals, resets and saves the key through user preferences', async () => {
        const store = configureStore({reducer: {preferences: preferencesReducer}});
        store.dispatch(setPreference({name: 'carto_maps_api_key', value: 'saved-carto-key'}));
        socket.emit.mockImplementation((_event, payload, callback) => {
            callback({success: true, data: payload.data});
        });

        render(
            <Provider store={store}>
                <ThemeProvider theme={setupTheme('light')}>
                    <PreferencesForm mode="integrations" />
                </ThemeProvider>
            </Provider>
        );

        expect(screen.getByText('CARTO Maps API Key')).toBeInTheDocument();
        const input = screen.getByDisplayValue('saved-carto-key');
        expect(input).toHaveAttribute('type', 'password');
        const field = within(input.closest('.MuiStack-root'));
        fireEvent.click(field.getByRole('button', {name: 'Show API key'}));
        expect(input).toHaveAttribute('type', 'text');
        fireEvent.change(input, {target: {value: 'temporary-key'}});
        fireEvent.click(screen.getByRole('button', {name: 'Reset'}));
        expect(input).toHaveValue('saved-carto-key');
        expect(input).toHaveAttribute('type', 'password');

        fireEvent.change(input, {target: {value: 'new-carto-key'}});
        fireEvent.click(screen.getByRole('button', {name: 'Save Preferences'}));
        await waitFor(() => expect(socket.emit).toHaveBeenCalledWith(
            'api.call',
            expect.objectContaining({
                cmd: 'update-preferences',
                data: expect.arrayContaining([
                    expect.objectContaining({name: 'carto_maps_api_key', value: 'new-carto-key'}),
                ]),
            }),
            expect.any(Function)
        ));
        expect(store.getState().preferences.userPreferences).toContainEqual(
            expect.objectContaining({name: 'carto_maps_api_key', value: 'new-carto-key'})
        );
        await waitFor(() => expect(screen.getByRole('button', {name: 'Save Preferences'})).toBeDisabled());
    });
});
