import './telemetry-i18n.js';
import React from 'react';
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import TelemetryValuesTab from '../telemetry-values-tab.jsx';
import fixtures from '../../../../../backend/tests/fixtures/viewer.json';

vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({
    useUserTimeSettings: () => ({timezone: 'UTC', locale: 'en-US'}),
}));

describe('LASARSAT backend presentation', () => {
    it.each([
        ['lasarsat0', ['Power system', 'Temperatures', 'Magnetometer', 'Gyroscope', 'Payload']],
        ['lasarsat1', ['Panel temperatures', 'Diode readings']],
        ['lasarsat2', ['Temperatures', 'Communications']],
    ])('renders real capture %s without local satellite rules', (name, groups) => {
        render(<TelemetryValuesTab telemetry={fixtures.real[name].telemetry} />);
        expect(screen.getByText('LASARSAT')).toBeInTheDocument();
        for (const group of groups) expect(screen.getByRole('region', {name: group})).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('no verified conversion');
        expect(screen.getAllByText(/\(raw\)$/).length).toBeGreaterThan(0);
        expect(screen.queryByText(/dBm|°C/)).not.toBeInTheDocument();
    });

    it('keeps the frame error visible for an invalid real capture', () => {
        render(<TelemetryValuesTab telemetry={fixtures.real.lasarsat3.telemetry} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid destination callsign');
        expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });
});
