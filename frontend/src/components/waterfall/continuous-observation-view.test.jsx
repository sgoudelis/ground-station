import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import '../../i18n/config.js';
import ContinuousObservationView from './continuous-observation-view.jsx';
import reducer, { setVfoMuted } from './vfo-marker/vfo-slice.jsx';

const audio = vi.hoisted(() => ({ setVfoMute: vi.fn() }));
vi.mock('../dashboard/audio-provider.jsx', () => ({ useAudio: () => audio }));

it('shows immutable channel details and supports local muting of the tenth VFO', () => {
    const store = configureStore({ reducer: { vfo: reducer } });
    audio.setVfoMute.mockImplementation((vfoNumber, muted) => store.dispatch(setVfoMuted({ vfoNumber, muted })));
    render(<Provider store={store}><ContinuousObservationView observation={{ name: 'VHF', vfos: {
        10: { center_freq: 145800000, bandwidth: 12500, modulation: 'fm', decoder: 'none' },
    } }} /></Provider>);
    expect(screen.getByText('VFO 10 · 145.800000 MHz')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mute VFO 10' }));
    expect(audio.setVfoMute).toHaveBeenCalledWith(10, true);
    expect(screen.getByRole('button', { name: 'Unmute VFO 10' })).toBeVisible();
});
