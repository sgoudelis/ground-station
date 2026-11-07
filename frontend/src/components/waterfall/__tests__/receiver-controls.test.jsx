import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import '../../../i18n/config.js';
import SdrParameterFields from '../../common/sdr-parameter-fields.jsx';
import SdrSessionFields from '../../scheduler/sdr-session-fields.jsx';
import ReceiverStatus from '../receiver-status.jsx';
import reducer, { updateSDRConfig } from '../waterfall-slice.jsx';

const capabilities = {
    gain_elements: { rx: ['PGA'] }, gain_ranges: { rx: { PGA: { min: 0, max: 76, step: 1 } } },
    bandwidths: { rx: [200000, 56000000] },
    bandwidth_ranges: { rx: [{ min: 200000, max: 56000000, step: 0 }] },
    clock_sources: ['internal', 'external'], clock_source: 'internal',
    time_sources: ['internal', 'external'], time_source: 'internal',
};
const parameters = { capabilities, gain_values: [0, 15, 45], sample_rate_values: [4000000], antennas: { rx: ['TX/RX'] } };

it.each(['uhd', 'soapysdrlocal'])('offers one effective B210 gain control for %s and passes the exact value', (type) => {
    const changed = vi.fn();
    render(<SdrParameterFields device={{ type, driver: 'uhd' }} parameters={parameters}
        value={{ gain: 15, sample_rate: 4000000, antenna_port: 'TX/RX', sdr_settings: {} }} onChange={changed} />);
    expect(screen.queryByRole('combobox', { name: 'Gain PGA' })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Gain (dB)' }));
    fireEvent.click(screen.getByRole('option', { name: '45 dB' }));
    expect(changed).toHaveBeenCalledWith('gain', 45);
});

it('shows actual native sources instead of ignored legacy selections and offers the sampled filter width', () => {
    const changed = vi.fn();
    render(<SdrParameterFields device={{ type: 'uhd' }} parameters={parameters}
        value={{ gain: 15, sample_rate: 4000000, antenna_port: 'TX/RX',
            sdr_settings: { clockSource: 'external', timeSource: 'external', bandwidth: 200000 } }}
        onSettingChange={changed} />);
    expect(screen.getByRole('combobox', { name: 'Clock Source' })).toHaveTextContent('internal');
    expect(screen.getByRole('combobox', { name: 'Time Source' })).toHaveTextContent('internal');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'IF filter bandwidth' }));
    fireEvent.click(screen.getByRole('option', { name: '4 MHz' }));
    expect(changed).toHaveBeenCalledWith('bandwidth', 4000000);
});

it('preserves the effective saved SoapyUHD stage gain when editing a scheduled session', async () => {
    function Session() {
        const [sdr, setSdr] = useState({ id: 'radio', gain: 15, sample_rate: 4000000,
            antenna_port: 'TX/RX', sdr_settings: { gains: { PGA: 45 } } });
        return <SdrSessionFields sdr={sdr} sdrs={[{ id: 'radio', type: 'soapysdrlocal', driver: 'uhd' }]}
            parameters={parameters} isSdrUsedByAnotherSession={() => false}
            onChange={(updates) => setSdr((previous) => ({ ...previous, ...updates }))} />;
    }
    render(<Session />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Gain/ })).toHaveTextContent('45 dB'));
    expect(screen.queryByRole('combobox', { name: 'Gain PGA' })).not.toBeInTheDocument();
});

it('shows actual gain mismatches and unavailable AGC without replacing requested state', () => {
    const status = { gain_db: 42, antenna: 'TX/RX', sample_rate: 4000000, bandwidth_hz: 200000,
        agc: null, clock_source: 'internal', time_source: 'internal' };
    render(<ReceiverStatus status={status} device={{ type: 'uhd' }}
        gain={15} sampleRate={4000000} antenna="TX/RX" settings={{}} />);
    const panel = screen.getByLabelText('Hardware readback');
    expect(within(panel).getByText('42 dB (requested: 15)')).toBeInTheDocument();
    expect(within(panel).getByText('200 kHz')).toBeInTheDocument();
    expect(within(panel).getByText('Unavailable')).toBeInTheDocument();
    const initial = reducer(undefined, { type: '@@INIT' });
    const measured = reducer({ ...initial, gain: 15 }, updateSDRConfig({ sdr_id: 'radio', receiver_status: status }));
    expect(measured.gain).toBe(15);
    expect(measured.sdrReceiverById.radio).toEqual(status);
    expect(reducer(measured, updateSDRConfig({ sdr_id: 'radio', receiver_status: null })).sdrReceiverById.radio).toBeNull();
});
