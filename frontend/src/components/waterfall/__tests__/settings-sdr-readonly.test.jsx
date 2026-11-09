import React from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { setupTheme } from '../../../theme.js';
import '../../../i18n/config.js';
import SdrAccordion from '../settings-sdr.jsx';

vi.mock('../background-stream-control.jsx', () => ({ default: () => null }));

// Keep references stable so rerenders also exercise the accordion's memo comparator.
const receiverProps = {
    expanded: true,
    gettingSDRParameters: false,
    isStreaming: false,
    selectedSDRId: 'radio',
    sdrs: [{ id: 'radio', name: 'Receiver', type: 'soapysdrremote' }],
    gainValues: [0, 20], localGain: 20,
    sampleRateValues: [1000000, 2000000], localSampleRate: 2000000,
    antennasList: { rx: ['RX'] }, selectedAntenna: 'RX',
    sdrCapabilities: { radio: {
        gain_elements: { rx: ['LNA'] }, gain_ranges: { rx: { LNA: { min: 0, max: 20, step: 10 } } },
        bandwidths: { rx: [1000000, 2000000] },
        clock_sources: ['internal', 'external'], clock_source: 'internal',
        time_sources: ['internal', 'external'], time_source: 'internal',
        settings: [{ key: 'bitpack', value: false }],
        sensor_values: { ref_locked: true },
    } },
    sdrSettings: {}, hasBiasT: true, biasT: false,
    hasTunerAgc: true, hasSoapyAgc: true, hasRtlAgc: true,
};
const theme = setupTheme();
const receiver = (props = {}) => <ThemeProvider theme={theme}>
    <SdrAccordion {...receiverProps} {...props} />
</ThemeProvider>;

it('visibly disables every SDR control for continuous viewers while leaving the accordion usable', () => {
    const expanded = vi.fn();
    const gainChanged = vi.fn();
    render(receiver({ readOnly: true, isStreaming: true, joinedSdrId: 'radio',
        onAccordionChange: expanded, onGainChange: gainChanged }));

    const controls = screen.getAllByRole('combobox');
    expect(controls).toHaveLength(8);
    controls.forEach((control) => {
        expect(control).toHaveAttribute('aria-disabled', 'true');
        expect(control).toHaveClass('Mui-disabled');
    });
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(5);
    switches.forEach((control) => expect(control).toBeDisabled());
    expect(screen.getByRole('button', { name: /^Reload SDR parameters/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Stop the continuous observation in the scheduler to edit these SDR settings.')).toBeVisible();
    expect(screen.getByText('Locked')).toBeVisible();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Gain (dB)' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(gainChanged).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^SDR/ }));
    expect(expanded).toHaveBeenCalledOnce();
});

it('updates disabled styling on joining and restores normal editing on leaving', () => {
    const changed = vi.fn();
    const view = render(receiver({ readOnly: false, onGainChange: changed }));
    expect(screen.getByRole('combobox', { name: 'Gain (dB)' })).not.toHaveAttribute('aria-disabled', 'true');

    view.rerender(receiver({ readOnly: true, onGainChange: changed }));
    expect(screen.getByRole('combobox', { name: 'Gain (dB)' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('switch', { name: 'Enable Bias T' })).toBeDisabled();

    view.rerender(receiver({ readOnly: false, onGainChange: changed }));
    expect(screen.getByRole('combobox', { name: 'Gain (dB)' })).not.toHaveClass('Mui-disabled');
    expect(screen.getByRole('switch', { name: 'Enable Bias T' })).toBeEnabled();
    expect(screen.queryByText(/Stop the continuous observation/)).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Gain (dB)' }));
    fireEvent.click(screen.getByRole('option', { name: '0 dB' }));
    expect(changed).toHaveBeenCalledExactlyOnceWith(0);
});

it('cancels a pending Bias-T change when the receiver becomes view only', async () => {
    const changed = vi.fn();
    const view = render(receiver({ readOnly: false, onBiasTChange: changed }));
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Bias T' }));
    expect(screen.getByRole('dialog', { name: 'Enable Bias-T?' })).toBeVisible();

    view.rerender(receiver({ readOnly: true, onBiasTChange: changed }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('switch', { name: 'Enable Bias T' })).toBeDisabled();
    expect(changed).not.toHaveBeenCalled();
});
