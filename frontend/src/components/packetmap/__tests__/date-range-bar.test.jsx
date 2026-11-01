import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import DateRangeBar from '../date-range-bar.jsx';

await i18n.use(initReactI18next).init({lng: 'en', resources: {}});
vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({
    useUserTimeSettings: () => ({timezone: 'Europe/Athens', locale: 'en-GB'}),
}));

const range = {start: '2026-11-01T00:00:00Z', end: '2026-11-02T00:00:00Z'};
const available = {start: '2026-10-01T00:00:00Z', end: '2026-11-01T20:00:00Z'};

describe('Packet map dates', () => {
    it('applies date inputs in the station timezone and rejects reversed intervals', () => {
        const onChange = vi.fn();
        render(<DateRangeBar range={range} availableRange={available} onChange={onChange} />);
        expect(screen.getByLabelText('From')).toHaveValue('2026-11-01T02:00');
        fireEvent.change(screen.getByLabelText('From'), {target: {value: '2026-11-01T05:00'}});
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: 'Apply'}));
        expect(onChange).toHaveBeenCalledWith({start: '2026-11-01T03:00:00.000Z', end: range.end});
        fireEvent.change(screen.getByLabelText('To'), {target: {value: '2026-10-01T05:00'}});
        expect(screen.getByRole('button', {name: 'Apply'})).toBeDisabled();
    });

    it('uses the library availability for All dates and commits keyboard slider changes', () => {
        const onChange = vi.fn();
        render(<DateRangeBar range={range} availableRange={available} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', {name: 'All dates'}));
        expect(onChange).toHaveBeenLastCalledWith(available);
        onChange.mockClear();
        const slider = screen.getByRole('slider', {name: 'Range start'});
        // MUI commits native input changes immediately for keyboard access.
        fireEvent.change(slider, {target: {value: Date.parse('2026-10-15T00:00:00Z')}});
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange.mock.calls[0][0].start).toBe('2026-10-15T00:00:00.000Z');
    });

    it('preserves exact capture endpoints when editing one side of a range', () => {
        const onChange = vi.fn();
        const precise = {start: '2026-10-01T00:00:00.123456Z', end: '2026-11-01T20:00:00.910671Z'};
        render(<DateRangeBar range={precise} availableRange={precise} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', {name: 'Apply'}));
        expect(onChange).toHaveBeenLastCalledWith(precise);
        fireEvent.change(screen.getByRole('slider', {name: 'Range start'}), {
            target: {value: Date.parse('2026-10-15T00:00:00Z')},
        });
        expect(onChange.mock.lastCall[0].end).toBe(precise.end);
    });
});
