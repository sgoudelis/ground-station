import './telemetry-i18n.js';
import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import TelemetryValuesTab from '../telemetry-values-tab.jsx';
import fixtures from '../../../../../backend/tests/fixtures/viewer.json';

vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({
    useUserTimeSettings: () => ({timezone: 'UTC', locale: 'en-US'}),
}));

describe('Common packet contents', () => {
    it('keeps independent USP messages and statuses in one view', () => {
        render(<TelemetryValuesTab telemetry={fixtures.legacy.messages.telemetry} />);
        for (const value of ['UHF radio beacon', 'Power system telemetry', '7.976 V', '4.75 °C', '-5 °C', '0 mA', 'No']) {
            expect(screen.getByText(value)).toBeInTheDocument();
        }
        expect(screen.getByText(/0xDE21.*Device 4 → 1/)).toBeInTheDocument();
        expect(screen.getByText(/carries no satellite telemetry/)).toBeInTheDocument();
        expect(screen.getByText(/not decoded yet/)).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Truncated USP message');
        fireEvent.click(screen.getAllByText('Raw fields and reserved bytes')[1]);
        expect(screen.getByText('7976')).toBeVisible();
    });

    it('shows a real USP capture using the same renderer', () => {
        render(<TelemetryValuesTab telemetry={fixtures.real.umka.telemetry} />);
        expect(screen.getByText('UHF radio beacon')).toBeInTheDocument();
        expect(screen.getByText('Power system telemetry')).toBeInTheDocument();
        expect(screen.getAllByText(/time \(UTC\)/).length).toBeGreaterThanOrEqual(2);
    });

    it('shows Tianqi labels and a formatted spacecraft clock', () => {
        render(<TelemetryValuesTab telemetry={fixtures.real.tianqi.telemetry} />);
        expect(screen.getByText('Fleet satellite identifier')).toBeInTheDocument();
        expect(screen.getByText('Spacecraft time (UTC)')).toBeInTheDocument();
        expect(screen.queryByText('time_unix_s')).not.toBeInTheDocument();
    });

    it('retains text beacons and meaningful parser errors', () => {
        const {unmount} = render(<TelemetryValuesTab telemetry={fixtures.legacy.text.telemetry} />);
        expect(screen.getByText('Greetings from LASARSAT')).toBeInTheDocument();
        unmount();
        render(<TelemetryValuesTab telemetry={fixtures.legacy.malformed.telemetry} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Expected 11 PSU fields, received 3');
        expect(screen.queryByText(/No decoded telemetry/)).not.toBeInTheDocument();
    });

    it('keeps literal offline legacy values available without guessing units', () => {
        render(<TelemetryValuesTab telemetry={{telemetry: {
            values: {battery_current_a: 0.125}, raw_fields: {battery_current_raw: 1632},
        }}} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Connect to the backend');
        expect(screen.getByText('battery_current_a')).toBeInTheDocument();
        expect(screen.getByText('0.125')).toBeInTheDocument();
        expect(screen.getByText('1632')).toBeInTheDocument();
    });
});
