import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DecoderParamsDialog from '../decoder-params-dialog.jsx';
import { TranscriptionParamsDialog } from '../vfo-settings/vfo-dialogs.jsx';

vi.mock('../../common/socket.jsx', () => ({
    useSocket: () => ({ socket: null }),
}));

vi.mock('../../target/transmitter-selectors.js', () => {
    const transmitters = [{ id: 'tx-1' }];
    return { selectRunningRigTransmitters: () => transmitters };
});

vi.mock('../../scheduler/decoder-config-suggestion.jsx', () => ({
    DecoderConfigSuggestion: ({ show, onApply, applyLabel }) => show && (
        <button onClick={() => onApply({ baudrate: 1200, framing: 'geoscan', framing_params: { frame_size: 74 } })}>
            {applyLabel}
        </button>
    ),
}));

const store = configureStore({
    reducer: () => ({ targetSatTrack: { satelliteData: { details: null }, trackerViews: {} } }),
});

const chooseOption = (label, option) => {
    fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
    fireEvent.click(screen.getByRole('option', { name: option }));
};

const renderDecoderDialog = (vfo, onVFOPropertyChange = vi.fn(), onClose = vi.fn()) => render(
    <Provider store={store}>
        <DecoderParamsDialog
            open
            onClose={onClose}
            vfoIndex={1}
            vfoMarkers={{ 1: vfo }}
            vfoActive={{ 1: true }}
            onVFOPropertyChange={onVFOPropertyChange}
        />
    </Provider>
);

describe('Waterfall VFO parameter dialogs', () => {
    it('loads and applies a custom LoRa preamble as an integer only after Apply', () => {
        const onVFOPropertyChange = vi.fn();
        renderDecoderDialog({
            decoder: 'lora', parametersEnabled: true,
            parameters: { lora_preamble_len: 15, lora_sf: 8 },
        }, onVFOPropertyChange);

        const input = screen.getByRole('spinbutton', { name: 'Preamble Length' });
        expect(input).toHaveValue(15);
        fireEvent.change(input, { target: { value: '17' } });
        expect(onVFOPropertyChange).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onVFOPropertyChange).toHaveBeenCalledExactlyOnceWith(1, {
            parameters: { lora_preamble_len: 17, lora_sf: 8 },
        });
    });

    it('blocks empty, fractional, and out-of-range preambles until corrected', () => {
        const onVFOPropertyChange = vi.fn();
        renderDecoderDialog({
            decoder: 'lora', parametersEnabled: true, parameters: {},
        }, onVFOPropertyChange);

        const input = screen.getByRole('spinbutton', { name: 'Preamble Length' });
        const apply = screen.getByRole('button', { name: 'Apply' });
        expect(input).toHaveValue(8);
        for (const value of ['', '4', '15.5', '65536']) {
            fireEvent.change(input, { target: { value } });
            expect(input).toHaveAttribute('aria-invalid', 'true');
            expect(apply).toBeDisabled();
            fireEvent.click(apply);
            expect(onVFOPropertyChange).not.toHaveBeenCalled();
        }

        fireEvent.change(input, { target: { value: '18' } });
        expect(input).toHaveAttribute('aria-invalid', 'false');
        expect(apply).toBeEnabled();
        fireEvent.click(apply);
        expect(onVFOPropertyChange).toHaveBeenCalledExactlyOnceWith(1, {
            parameters: { lora_preamble_len: 18 },
        });
    });

    it('commits several transcription choices in one update only after Apply', () => {
        const onVFOPropertyChange = vi.fn();
        const onClose = vi.fn();
        const vfo = {
            transcriptionProvider: 'deepgram',
            transcriptionEnabled: true,
            transcriptionLanguage: 'auto',
            transcriptionTranslateTo: 'none',
            transcriptionTranslationBackend: 'google',
        };

        render(
            <TranscriptionParamsDialog
                open
                onClose={onClose}
                vfoIndex={1}
                vfoMarkers={{ 1: vfo }}
                onVFOPropertyChange={onVFOPropertyChange}
            />
        );

        chooseOption('Source Language', /Greek/);
        chooseOption('Translate To', /English/);
        chooseOption('Translation Service', 'LibreTranslate');
        expect(onVFOPropertyChange).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onVFOPropertyChange).toHaveBeenCalledExactlyOnceWith(1, {
            transcriptionLanguage: 'el',
            transcriptionTranslateTo: 'en',
            transcriptionTranslationBackend: 'libretranslate',
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    }, 10000);

    it('disables Parakeet translation and clears its target on Apply', () => {
        const onVFOPropertyChange = vi.fn();
        render(
            <TranscriptionParamsDialog
                open
                onClose={vi.fn()}
                vfoIndex={1}
                vfoMarkers={{ 1: {
                    transcriptionProvider: 'parakeet',
                    transcriptionEnabled: true,
                    transcriptionLanguage: 'auto',
                    transcriptionTranslateTo: 'el',
                    transcriptionTranslationBackend: 'google',
                } }}
                onVFOPropertyChange={onVFOPropertyChange}
            />
        );

        chooseOption('Translation Service', 'No translation');
        expect(screen.getByRole('combobox', { name: 'Translate To' })).toHaveAttribute('aria-disabled', 'true');
        expect(onVFOPropertyChange).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

        expect(onVFOPropertyChange).toHaveBeenCalledExactlyOnceWith(1, {
            transcriptionTranslationBackend: 'none',
            transcriptionTranslateTo: 'none',
        });
    });

    it('commits decoder options and conditional fields in one update', () => {
        const onVFOPropertyChange = vi.fn();
        renderDecoderDialog({
            decoder: 'fsk',
            parametersEnabled: true,
            parameters: { fsk_baudrate: 9600, fsk_framing: 'ax25' },
            lockedTransmitterId: 'none',
        }, onVFOPropertyChange);

        chooseOption('Baud Rate', '1200 baud');
        chooseOption('Framing Protocol', 'GEOSCAN');
        chooseOption('GEOSCAN Frame Size', '74 bytes');
        expect(onVFOPropertyChange).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onVFOPropertyChange).toHaveBeenCalledExactlyOnceWith(1, {
            parameters: {
                fsk_baudrate: 1200,
                fsk_framing: 'geoscan',
                fsk_geoscan_frame_size: 74,
            },
        });
    });

    it('discards a suggested decoder configuration when cancelled', () => {
        const onVFOPropertyChange = vi.fn();
        const onClose = vi.fn();
        const vfo = {
            decoder: 'fsk',
            parametersEnabled: false,
            parameters: { fsk_baudrate: 9600 },
            lockedTransmitterId: 'tx-1',
        };
        const view = renderDecoderDialog(vfo, onVFOPropertyChange, onClose);

        fireEvent.click(screen.getByRole('button', { name: 'Use suggestion' }));
        expect(onVFOPropertyChange).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onVFOPropertyChange).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);

        view.unmount();
        renderDecoderDialog(vfo, onVFOPropertyChange, onClose);
        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Use suggestion' }));
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onVFOPropertyChange).toHaveBeenCalledExactlyOnceWith(1, {
            parametersEnabled: true,
            parameters: {
                fsk_baudrate: 1200,
                fsk_framing: 'geoscan',
                fsk_geoscan_frame_size: 74,
            },
        });
    });

    it('shows GNSS capture guidance and tunes the SDR before applying the VFO frequency', async () => {
        const onVFOPropertyChange = vi.fn();
        const onCenterFrequencyChange = vi.fn().mockResolvedValue({ success: true });
        const onSampleRateChange = vi.fn().mockResolvedValue({ success: true });
        const vfo = {
            decoder: 'gnss',
            frequency: 145_000_000,
            parametersEnabled: false,
            parameters: {},
            lockedTransmitterId: 'none',
        };
        const gnssStore = configureStore({
            reducer: () => ({
                targetSatTrack: { satelliteData: { details: null }, trackerViews: {} },
                waterfall: { selectedSDRId: 'rtl-sdr' },
                vfo: { vfoMarkers: { 1: vfo } },
            }),
        });

        render(
            <Provider store={gnssStore}>
                <DecoderParamsDialog
                    open
                    onClose={vi.fn()}
                    vfoIndex={1}
                    vfoMarkers={{ 1: vfo }}
                    vfoActive={{ 1: true }}
                    onVFOPropertyChange={onVFOPropertyChange}
                    centerFrequency={145_000_000}
                    sampleRate={2_000_000}
                    sampleRateValues={[2_000_000, 2_400_000]}
                    onCenterFrequencyChange={onCenterFrequencyChange}
                    onSampleRateChange={onSampleRateChange}
                />
            </Provider>
        );

        expect(screen.getByText(/Selected signals: GPS L1 C\/A/)).toBeInTheDocument();
        expect(screen.getByText(/SDR capture rate: 2.00 MS\/s/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Set SDR capture to 2.40 MS/s' }));
        await waitFor(() => expect(onSampleRateChange).toHaveBeenCalledWith(2_400_000));

        fireEvent.click(screen.getByRole('button', { name: 'Apply and tune receiver' }));
        await waitFor(() => expect(onCenterFrequencyChange).toHaveBeenCalledWith(1_575_420_000));
        expect(onVFOPropertyChange).toHaveBeenCalledWith(1, { frequency: 1_575_420_000 });
    });

    it('keeps GNSS draft and VFO frequency unchanged if receiver retuning fails', async () => {
        const onVFOPropertyChange = vi.fn();
        const vfo = { decoder: 'gnss', frequency: 145_000_000, parametersEnabled: false, parameters: {} };
        const gnssStore = configureStore({
            reducer: () => ({
                targetSatTrack: { satelliteData: { details: null }, trackerViews: {} },
                waterfall: { selectedSDRId: 'rtl-sdr' },
                vfo: { vfoMarkers: { 1: vfo } },
            }),
        });

        render(
            <Provider store={gnssStore}>
                <DecoderParamsDialog
                    open
                    onClose={vi.fn()}
                    vfoIndex={1}
                    vfoMarkers={{ 1: vfo }}
                    vfoActive={{ 1: true }}
                    onVFOPropertyChange={onVFOPropertyChange}
                    centerFrequency={145_000_000}
                    sampleRate={2_000_000}
                    sampleRateValues={[2_000_000]}
                    onCenterFrequencyChange={vi.fn().mockResolvedValue({ success: false, error: 'Retune refused' })}
                />
            </Provider>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Apply and tune receiver' }));
        await waitFor(() => expect(screen.getByText('Retune refused')).toBeInTheDocument());
        expect(onVFOPropertyChange).not.toHaveBeenCalled();
    });
});
