import React from 'react';
import {ThemeProvider} from '@mui/material/styles';
import {fireEvent, render, screen} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {setupTheme} from '../../../theme.js';
import '../../../i18n/config.js';
import SdrAccordion from '../settings-sdr.jsx';

vi.mock('../background-stream-control.jsx', () => ({ default: () => null }));

function renderGains(gainRanges, onGainElementChange = vi.fn()) {
    render(<ThemeProvider theme={setupTheme()}>
        <SdrAccordion expanded gettingSDRParameters={false} isStreaming={false}
            selectedSDRId="radio" sdrs={[{id: 'radio', name: 'RSPduo', type: 'soapysdrremote', driver: 'sdrplay'}]}
            gainValues={[30]} localGain={30} sampleRateValues={[4000000]} localSampleRate={4000000}
            antennasList={{rx: ['Tuner 2 50 ohm']}} selectedAntenna="Tuner 2 50 ohm"
            sdrCapabilities={{radio: {gain_elements: {rx: Object.keys(gainRanges)}, gain_ranges: {rx: gainRanges}}}}
            sdrSettings={{gains: {}}} onGainElementChange={onGainElementChange} />
    </ThemeProvider>);
}

it.each([0, null, undefined])('allows selecting the native RFGR state when the driver gain step is %s', (step) => {
    const changed = vi.fn();
    renderGains({IFGR: {min: 20, max: 59, step}, RFGR: {min: 0, max: 9, step}}, changed);
    fireEvent.mouseDown(screen.getByRole('combobox', {name: 'LNA attenuation state (RFGR)'}));
    fireEvent.click(screen.getByRole('option', {name: '4'}));
    expect(changed).toHaveBeenCalledWith('RFGR', 4);
    expect(screen.getByRole('combobox', {name: 'IF gain reduction (IFGR)'})).toBeInTheDocument();
});

it('preserves fractional increments supplied by the driver', () => {
    const changed = vi.fn();
    renderGains({LNA: {min: 0, max: 1, step: 0.5}}, changed);
    fireEvent.mouseDown(screen.getByRole('combobox', {name: 'Gain LNA'}));
    fireEvent.click(screen.getByRole('option', {name: '0.5 dB'}));
    expect(changed).toHaveBeenCalledWith('LNA', 0.5);
});
