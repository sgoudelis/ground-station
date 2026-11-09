import React from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { setupTheme } from '../../../theme.js';
import FrequencyControlAccordion from '../settings-frequency.jsx';
import '../../../i18n/config.js';

it('tunes the exact transmitter choice again when the same destination is picked twice', () => {
    const transmitters = [
        {
            id: 'shared-transmitter',
            uiId: 'target-1:shared-transmitter',
            trackerId: 'target-1',
            trackerTargetName: 'ISS',
            description: 'Beacon',
            downlink_low: 145000000,
            mode: 'FM',
            source: 'SatNOGS',
            alive: true,
        },
        {
            id: 'shared-transmitter',
            uiId: 'target-2:shared-transmitter',
            trackerId: 'target-2',
            trackerTargetName: 'Moon',
            description: 'Beacon',
            downlink_low: 437000000,
            mode: 'FM',
            source: 'SatNOGS',
            alive: true,
        },
    ];
    const onGoToTransmitter = vi.fn();

    render(
        <ThemeProvider theme={setupTheme()}>
            <FrequencyControlAccordion
                expanded
                onAccordionChange={vi.fn()}
                centerFrequency={145000000}
                onCenterFrequencyChange={vi.fn()}
                availableTransmitters={transmitters}
                onGoToTransmitter={onGoToTransmitter}
                selectedOffsetMode="none"
                onOffsetModeChange={vi.fn()}
                selectedOffsetValue="0"
                onOffsetValueChange={vi.fn()}
                isRecording={false}
                selectedSDRId="radio"
                isStreaming={false}
            />
        </ThemeProvider>,
    );

    const goToButton = screen.getByRole('button', { name: /go.to.transmitter/i });
    for (let click = 1; click <= 2; click += 1) {
        fireEvent.click(goToButton);
        fireEvent.click(screen.getByRole('menuitem', { name: /T2.*Moon/ }));
        expect(onGoToTransmitter).toHaveBeenCalledTimes(click);
        expect(onGoToTransmitter).toHaveBeenLastCalledWith(transmitters[1]);
    }
});

// Stable props ensure joining and leaving also exercise the memo comparator.
const frequencyProps = {
    expanded: true,
    onAccordionChange: vi.fn(),
    centerFrequency: 869525000,
    onCenterFrequencyChange: vi.fn(),
    availableTransmitters: [{ id: 'meshtastic', description: 'Meshtastic', downlink_low: 869525000, mode: 'LoRa' }],
    onGoToTransmitter: vi.fn(),
    selectedOffsetMode: 'manual',
    onOffsetModeChange: vi.fn(),
    selectedOffsetValue: '1000',
    onOffsetValueChange: vi.fn(),
    isRecording: false,
    selectedSDRId: 'radio',
    isStreaming: true,
};
const theme = setupTheme();
const frequency = (props = {}) => <ThemeProvider theme={theme}>
    <FrequencyControlAccordion {...frequencyProps} {...props} />
</ThemeProvider>;

it('disables frequency editing for continuous viewers and keeps the accordion usable', () => {
    const expanded = vi.fn();
    const tuned = vi.fn();
    render(frequency({ readOnly: true, onAccordionChange: expanded, onCenterFrequencyChange: tuned }));

    const offset = screen.getByRole('combobox');
    expect(offset).toHaveAttribute('aria-disabled', 'true');
    expect(offset).toHaveClass('Mui-disabled');
    expect(screen.getByRole('spinbutton', { name: 'Manual Offset (Hz)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Go to transmitter' })).toBeDisabled();
    const dialButtons = screen.getAllByLabelText(/^(Increase|Decrease) by/);
    dialButtons.forEach((button) => expect(button).toBeDisabled());

    fireEvent.click(dialButtons[0]);
    fireEvent.mouseDown(offset);
    expect(tuned).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Frequency control' }));
    expect(expanded).toHaveBeenCalledOnce();
});

it('updates on joining and restores normal frequency editing on leaving', () => {
    const tuned = vi.fn();
    const changed = vi.fn();
    const props = { onCenterFrequencyChange: tuned, onOffsetValueChange: changed };
    const view = render(frequency(props));
    expect(screen.getByRole('button', { name: 'Increase by 1000 Hz' })).toBeEnabled();

    view.rerender(frequency({ ...props, readOnly: true }));
    expect(screen.getByLabelText('Increase by 1000 Hz')).toBeDisabled();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-disabled', 'true');

    view.rerender(frequency({ ...props, readOnly: false }));
    expect(screen.getByRole('combobox')).not.toHaveClass('Mui-disabled');
    expect(screen.getByRole('button', { name: 'Go to transmitter' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Increase by 1000 Hz' }));
    expect(tuned).toHaveBeenCalledExactlyOnceWith(869526);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2000' } });
    expect(changed).toHaveBeenCalledExactlyOnceWith({ target: { value: '2000' } });
});

it.each(['transmitter', 'offset'])('closes the open %s menu when joining a continuous observation', async (menu) => {
    const tune = vi.fn();
    const offset = vi.fn();
    const props = { onGoToTransmitter: tune, onOffsetModeChange: offset };
    const view = render(frequency(props));
    if (menu === 'transmitter') {
        fireEvent.click(screen.getByRole('button', { name: 'Go to transmitter' }));
        expect(screen.getByRole('menu')).toBeVisible();
    } else {
        fireEvent.mouseDown(screen.getByRole('combobox'));
        expect(screen.getByRole('listbox')).toBeVisible();
    }

    view.rerender(frequency({ ...props, readOnly: true }));
    await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
    expect(tune).not.toHaveBeenCalled();
    expect(offset).not.toHaveBeenCalled();

    view.rerender(frequency({ ...props, readOnly: false }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});
