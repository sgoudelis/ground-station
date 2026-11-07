import React from 'react';
import {ThemeProvider} from '@mui/material/styles';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {setupTheme} from '../../../theme.js';
import '../../../i18n/config.js';
import SdrAccordion from '../settings-sdr.jsx';

vi.mock('../background-stream-control.jsx', () => ({default: () => null}));

function receiver(props = {}) {
    return <ThemeProvider theme={setupTheme()}>
        <SdrAccordion expanded gettingSDRParameters={false} isStreaming={false}
            selectedSDRId="radio" sdrs={[
                {id: 'radio', name: 'RTL-SDR', type: 'rtlsdrusbv4'},
                {id: 'other', name: 'Other receiver', type: 'rtlsdrusbv4'},
            ]}
            gainValues={[20]} localGain={20} sampleRateValues={[2048000]} localSampleRate={2048000}
            antennasList={{rx: ['RX']}} selectedAntenna="RX"
            hasBiasT biasT={false} {...props} />
    </ThemeProvider>;
}

it('keeps Bias-T off until the voltage warning is confirmed', async () => {
    const changed = vi.fn();
    render(receiver({onBiasTChange: changed}));
    const control = screen.getByRole('switch', {name: 'Enable Bias T'});
    fireEvent.click(control);

    const dialog = screen.getByRole('dialog', {name: 'Enable Bias-T?'});
    expect(dialog).toHaveAccessibleDescription(/DC voltage.*can damage.*all equipment in the signal path/);
    expect(within(dialog).getByRole('button', {name: 'Cancel'})).toHaveFocus();
    expect(control).not.toBeChecked();
    expect(changed).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', {name: 'Enable Bias-T'}));
    expect(changed).toHaveBeenCalledExactlyOnceWith(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it.each(['Cancel', 'Escape'])('leaves Bias-T off when dismissed using %s', async (method) => {
    const changed = vi.fn();
    render(receiver({onBiasTChange: changed}));
    const control = screen.getByRole('switch', {name: 'Enable Bias T'});
    fireEvent.click(control);
    const dialog = screen.getByRole('dialog');

    if (method === 'Cancel') {
        fireEvent.click(within(dialog).getByRole('button', {name: 'Cancel'}));
    } else {
        fireEvent.keyDown(dialog, {key: 'Escape', code: 'Escape'});
    }

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(control).not.toBeChecked();
    expect(changed).not.toHaveBeenCalled();
});

it('disables Bias-T immediately and asks again when enabling it', () => {
    const changed = vi.fn();
    const view = render(receiver({biasT: true, onBiasTChange: changed}));
    fireEvent.click(screen.getByRole('switch', {name: 'Enable Bias T'}));
    expect(changed).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    view.rerender(receiver({biasT: false, onBiasTChange: changed}));
    fireEvent.click(screen.getByRole('switch', {name: 'Enable Bias T'}));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(changed).toHaveBeenCalledTimes(1);
});

it('cancels a pending confirmation when the selected receiver changes', async () => {
    const changed = vi.fn();
    const view = render(receiver({onBiasTChange: changed}));
    fireEvent.click(screen.getByRole('switch', {name: 'Enable Bias T'}));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    view.rerender(receiver({selectedSDRId: 'other', onBiasTChange: changed}));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(changed).not.toHaveBeenCalled();
});
