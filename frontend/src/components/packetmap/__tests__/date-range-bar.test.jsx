import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import DateRangeBar from '../date-range-bar.jsx';

await i18n.use(initReactI18next).init({lng: 'en', resources: {}});
const {timeSettings} = vi.hoisted(() => ({timeSettings: {timezone: 'Europe/Athens', locale: 'en-GB'}}));
vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({useUserTimeSettings: () => timeSettings}));
beforeEach(() => { timeSettings.locale = 'en-GB'; });

const range = {start: '2026-11-01T00:00:00Z', end: '2026-11-02T00:00:00Z'};
const available = {start: '2026-10-01T00:00:00Z', end: '2026-11-01T20:00:00Z'};

describe('Packet map dates', () => {
    it('applies date inputs in the station timezone and rejects reversed intervals', () => {
        const onChange = vi.fn();
        render(<DateRangeBar range={range} availableRange={available} onChange={onChange} />);
        expect(screen.getByLabelText('From')).toHaveValue('01/11/2026, 02:00');
        expect(screen.queryByText('Europe/Athens')).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('From'), {target: {value: '01/11/2026, 05:00'}});
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: 'Apply'}));
        expect(onChange).toHaveBeenCalledWith({start: '2026-11-01T03:00:00.000Z', end: range.end});
        fireEvent.change(screen.getByLabelText('To'), {target: {value: '01/10/2026, 05:00'}});
        expect(screen.getByRole('button', {name: 'Apply'})).toBeDisabled();
    });

    it('scrubs one cursor inside the applied query range without changing the query', () => {
        const onChange = vi.fn();
        const onPlaybackTimeChange = vi.fn();
        const props = {range, availableRange: available, onChange, onPlaybackTimeChange};
        const {rerender} = render(<DateRangeBar {...props} playbackTime={Date.parse(range.end)} />);
        const slider = screen.getByRole('slider', {name: 'Playback time'});
        expect(screen.getAllByRole('slider')).toHaveLength(1);
        expect(slider).toHaveAttribute('min', String(Date.parse(range.start)));
        expect(slider).toHaveAttribute('max', String(Date.parse(range.end)));
        fireEvent.change(screen.getByLabelText('From'), {target: {value: '15/10/2026, 05:00'}});
        expect(slider).toHaveAttribute('min', String(Date.parse(range.start)));
        const cursor = Date.parse('2026-11-01T12:00:00Z');
        fireEvent.change(slider, {target: {value: cursor}});
        expect(onPlaybackTimeChange).toHaveBeenLastCalledWith(cursor);
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: 'All dates'}));
        expect(onChange).toHaveBeenLastCalledWith(available);
        rerender(<DateRangeBar {...props} range={available} playbackTime={Date.parse(available.end)} />);
        expect(slider).toHaveAttribute('min', String(Date.parse(available.start)));
        expect(slider).toHaveAttribute('max', String(Date.parse(available.end)));
        expect(slider).toHaveValue(String(Date.parse(available.end)));
    });

    it('preserves exact capture endpoints when editing one side of a range', () => {
        const onChange = vi.fn();
        const precise = {start: '2026-10-01T00:00:00.123456Z', end: '2026-11-01T20:00:00.910671Z'};
        render(<DateRangeBar range={precise} availableRange={precise} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', {name: 'Apply'}));
        expect(onChange).toHaveBeenLastCalledWith(precise);
        fireEvent.change(screen.getByLabelText('From'), {target: {value: '15/10/2026, 05:00'}});
        fireEvent.click(screen.getByRole('button', {name: 'Apply'}));
        expect(onChange.mock.lastCall[0]).toEqual({start: '2026-10-15T02:00:00.000Z', end: precise.end});
    });

    it('enters LIVE without an end date, follows the latest time and applies start-only edits', () => {
        const onChange = vi.fn();
        const onPresetChange = vi.fn();
        const onPlaybackTimeChange = vi.fn();
        const props = {range, onChange, onPresetChange, onPlaybackTimeChange};
        const {rerender} = render(<DateRangeBar {...props} />);
        expect(screen.getByRole('button', {name: 'LIVE', exact: true})).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(screen.getByRole('button', {name: 'LIVE', exact: true}));
        expect(onPresetChange).toHaveBeenCalledExactlyOnceWith({start: range.start, end: null});
        expect(onChange).not.toHaveBeenCalled();
        const liveRange = {...range, end: null};
        const now = Date.parse(range.end);
        rerender(<DateRangeBar {...props} range={liveRange} playbackTime={now} />);
        expect(screen.getByLabelText('To')).toBeDisabled();
        expect(screen.getByLabelText('To')).toHaveValue('02/11/2026, 02:00');
        expect(screen.getByRole('button', {name: 'LIVE', exact: true})).toHaveAttribute('aria-pressed', 'true');
        const slider = screen.getByRole('slider', {name: 'Live time'});
        expect(slider).toBeDisabled();
        expect(slider).toHaveValue(String(now));
        rerender(<DateRangeBar {...props} range={liveRange} playbackTime={now + 3600000} />);
        expect(slider).toHaveValue(String(now + 3600000));
        expect(slider).toHaveAttribute('max', String(now + 3600000));
        expect(screen.getByLabelText('To')).toHaveValue('02/11/2026, 03:00');
        fireEvent.change(slider, {target: {value: now}});
        expect(onPlaybackTimeChange).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('From'), {target: {value: '01/11/2026, 05:00'}});
        fireEvent.click(screen.getByRole('button', {name: 'Apply'}));
        expect(onChange).toHaveBeenCalledExactlyOnceWith({start: '2026-11-01T03:00:00.000Z', end: null});
    });

    it('highlights packet activity independently of the pointer and clears it with new results', () => {
        const positions = [
            {kind: 'aprs', captured_at: '2026-11-01T06:00:00Z'},
            {kind: 'radiosonde', captured_at: '2026-11-01T18:00:00Z'},
        ];
        const props = {range, positions, onChange: vi.fn(), onPlaybackTimeChange: vi.fn()};
        const {container, rerender} = render(<DateRangeBar {...props} playbackTime={Date.parse(range.end)} />);
        const activity = () => [...container.querySelectorAll('.packet-timeline-activity line')]
            .map((line) => [line.getAttribute('x1'), line.getAttribute('x2')]);
        const highlighted = activity();
        expect(highlighted).toHaveLength(2);
        rerender(<DateRangeBar {...props} playbackTime={Date.parse(range.start)} />);
        expect(activity()).toEqual(highlighted);
        rerender(<DateRangeBar {...props} positions={[]} />);
        expect(activity()).toEqual([]);
    });

    it('disables a zero-duration playback window without inventing a wider range', () => {
        const instant = {start: range.start, end: range.start};
        render(<DateRangeBar range={instant} onChange={vi.fn()} />);
        const slider = screen.getByRole('slider', {name: 'Playback time'});
        expect(slider).toBeDisabled();
        expect(slider).toHaveAttribute('min', slider.getAttribute('max'));
    });

    it.each([
        ['en-US', '11/01/2026, 02:00 AM', '11/01/2026, 05:00 AM'],
        ['de-DE', '01.11.2026, 02:00', '01.11.2026, 05:00'],
        ['el-GR', '01/11/2026, 02:00 ΠΜ', '01/11/2026, 05:00 ΠΜ'],
    ])('displays and parses the selected %s format in the station timezone', (locale, shown, edited) => {
        timeSettings.locale = locale;
        const onChange = vi.fn();
        render(<DateRangeBar range={range} onChange={onChange} />);
        expect(screen.getByLabelText('From')).toHaveValue(shown);
        fireEvent.change(screen.getByLabelText('From'), {target: {value: edited}});
        fireEvent.click(screen.getByRole('button', {name: 'Apply'}));
        expect(onChange).toHaveBeenLastCalledWith({start: '2026-11-01T03:00:00.000Z', end: range.end});
    });

    it('reformats existing dates when the formatting preference changes without changing the query', () => {
        const onChange = vi.fn();
        const {rerender} = render(<DateRangeBar range={range} onChange={onChange} />);
        timeSettings.locale = 'en-US';
        rerender(<DateRangeBar range={range} onChange={onChange} />);
        expect(screen.getByLabelText('From')).toHaveValue('11/01/2026, 02:00 AM');
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: 'Apply'}));
        expect(onChange).toHaveBeenLastCalledWith(range);
    });
});
