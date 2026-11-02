import React from 'react';
import {ThemeProvider} from '@mui/material/styles';
import {fireEvent, render, screen} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {setupTheme} from '../../../theme.js';
import '../../../i18n/config.js';
import SdrAccordion from '../settings-sdr.jsx';

const widths = [200000, 300000, 600000, 1536000, 5000000, 6000000, 7000000, 8000000];

function receiver(props = {}) {
    return <ThemeProvider theme={setupTheme()}>
        <SdrAccordion expanded gettingSDRParameters={false} isStreaming={false}
            selectedSDRId="radio" sdrs={[{id: 'radio', name: 'RSPduo', type: 'soapysdrremote', driver: 'sdrplay'}]}
            gainValues={[48]} localGain={48} sampleRateValues={[2000000, 4000000]} localSampleRate={4000000}
            antennasList={{rx: ['Tuner 2 50 ohm']}} selectedAntenna="Tuner 2 50 ohm"
            sdrCapabilities={{radio: {bandwidths: {rx: widths}}}} sdrSettings={{}}
            {...props} />
    </ThemeProvider>;
}

it('preserves Driver default for existing settings and offers Auto and native filters', () => {
    const changed = vi.fn();
    render(receiver({onBandwidthChange: changed}));
    const control = screen.getByRole('combobox', {name: 'IF filter bandwidth'});
    expect(control).toHaveTextContent('Driver default');
    fireEvent.mouseDown(control);
    expect(screen.getAllByRole('option')).toHaveLength(widths.length + 2);
    fireEvent.click(screen.getByRole('option', {name: 'Auto'}));
    expect(changed).toHaveBeenCalledWith('auto');
    fireEvent.mouseDown(control);
    fireEvent.click(screen.getByRole('option', {name: '5 MHz'}));
    expect(changed).toHaveBeenCalledWith(5000000);
});

it('shows measured bandwidth and drops stale readback when sample rate changes', () => {
    const props = {
        isStreaming: true,
        sdrSettings: {bandwidth: 'auto'},
        bandwidthStatus: {mode: 'auto', sample_rate: 4000000, actual_hz: 5000000},
    };
    const view = render(receiver(props));
    expect(screen.getByText('Applied: 5 MHz')).toBeInTheDocument();
    view.rerender(receiver({...props, localSampleRate: 2000000}));
    expect(screen.queryByText('Applied: 5 MHz')).not.toBeInTheDocument();
});

it('reports limited capture and configuration failures from the receiver', () => {
    render(receiver({
        isStreaming: true,
        sdrSettings: {bandwidth: 'auto'},
        bandwidthStatus: {
            mode: 'auto', sample_rate: 4000000, actual_hz: 1536000,
            error: 'Device rejected the filter',
        },
    }));
    expect(screen.getByText(/Applied: 1.536 MHz.*covers part of the sampled span.*Device rejected the filter/))
        .toBeInTheDocument();
});

it('limits low-rate SDRplay choices and disables changes during recording', () => {
    const view = render(receiver({localSampleRate: 2000000}));
    fireEvent.mouseDown(screen.getByRole('combobox', {name: 'IF filter bandwidth'}));
    expect(screen.queryByRole('option', {name: '5 MHz'})).not.toBeInTheDocument();
    expect(screen.getByRole('option', {name: '1.536 MHz'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', {name: 'Driver default'}));
    view.rerender(receiver({isRecording: true}));
    expect(screen.getByRole('combobox', {name: 'IF filter bandwidth'})).toHaveAttribute('aria-disabled', 'true');
});

it('hides the control when the receiver has no discrete bandwidth choices', () => {
    render(receiver({sdrCapabilities: {radio: {bandwidths: {rx: null}}}}));
    expect(screen.queryByRole('combobox', {name: 'IF filter bandwidth'})).not.toBeInTheDocument();
});
