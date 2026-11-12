import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import '../../i18n/config.js';
import RegenerationPreviewDialog from './regeneration-preview-dialog.jsx';

vi.mock('../../hooks/useUserTimeSettings.jsx', () => ({
    useUserTimeSettings: () => ({ timezone: 'UTC', locale: 'en' }),
}));

const previewData = {
    current_strategy: 'priority',
    conflicting_passes: [{
        pass_id: 'candidate-1',
        strategy_action: 'keep_existing',
        time_window: '12:00 - 12:10',
        new_pass: {
            satellite: 'Candidate Sat',
            elevation: 45,
            start: '2026-10-20T12:00:00Z',
            end: '2026-10-20T12:10:00Z',
        },
        blockers: [{
            id: 'existing-1',
            satellite: 'Existing Sat',
            elevation: 30,
            start: '2026-10-20T12:02:00Z',
            end: '2026-10-20T12:08:00Z',
        }],
    }],
};

it('selects the corresponding resolution when either satellite card is activated', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<RegenerationPreviewDialog open onClose={() => {}} previewData={previewData} onConfirm={onConfirm} />);

    const candidateCard = screen.getByRole('button', { name: /Candidate Pass Candidate Sat/ });
    const existingCard = screen.getByRole('button', { name: /Conflicts With Existing Existing Sat/ });
    const scheduleRadio = screen.getByRole('radio', { name: /Schedule New Pass/ });
    const keepRadio = screen.getByRole('radio', { name: /Keep Existing Pass/ });

    expect(existingCard).toHaveAttribute('aria-pressed', 'true');
    expect(keepRadio).toBeChecked();

    await user.click(candidateCard);
    expect(candidateCard).toHaveAttribute('aria-pressed', 'true');
    expect(existingCard).toHaveAttribute('aria-pressed', 'false');
    expect(scheduleRadio).toBeChecked();

    existingCard.focus();
    await user.keyboard('{Enter}');
    expect(existingCard).toHaveAttribute('aria-pressed', 'true');
    expect(keepRadio).toBeChecked();

    await user.click(screen.getByRole('button', { name: /Confirm & Generate/ }));
    expect(onConfirm).toHaveBeenCalledWith({ 'candidate-1': 'keep_existing' });
});

it('shows generation progress and prevents another confirmation while the request is pending', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const props = { open: true, onClose, previewData, onConfirm };
    const { rerender } = render(<RegenerationPreviewDialog {...props} />);

    rerender(<RegenerationPreviewDialog {...props} isGenerating />);

    const confirmButton = screen.getByRole('button', { name: 'Confirm & Generate' });
    expect(confirmButton).toBeDisabled();
    expect(confirmButton).toContainElement(screen.getByRole('progressbar'));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    rerender(<RegenerationPreviewDialog {...props} />);
    expect(confirmButton).toBeEnabled();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await userEvent.setup().click(confirmButton);
    expect(onConfirm).toHaveBeenCalledOnce();
});

it('preserves started observations and disables both replacement controls', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const data = {
        ...previewData,
        conflicting_passes: [{
            ...previewData.conflicting_passes[0],
            replacement_allowed: false,
        }],
    };
    render(<RegenerationPreviewDialog open onClose={() => {}} previewData={data} onConfirm={onConfirm} />);

    const candidateCard = screen.getByRole('button', { name: /Candidate Pass Candidate Sat/ });
    const scheduleRadio = screen.getByRole('radio', { name: /Schedule New Pass/ });
    expect(candidateCard).toBeDisabled();
    expect(scheduleRadio).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Keep Existing Pass/ })).toBeChecked();
    expect(screen.getByText(/An existing observation has started and will be kept/)).toBeInTheDocument();

    expect(scheduleRadio).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: /Confirm & Generate/ }));
    expect(onConfirm).toHaveBeenCalledWith({ 'candidate-1': 'keep_existing' });
});

it('discards a replacement selection when refreshed preview data protects the observation', async () => {
    const user = userEvent.setup();
    const props = { open: true, onClose: () => {}, onConfirm: vi.fn() };
    const { rerender } = render(<RegenerationPreviewDialog {...props} previewData={previewData} />);
    await user.click(screen.getByRole('button', { name: /Candidate Pass Candidate Sat/ }));
    expect(screen.getByRole('radio', { name: /Schedule New Pass/ })).toBeChecked();

    rerender(<RegenerationPreviewDialog {...props} previewData={{
        ...previewData,
        conflicting_passes: [{ ...previewData.conflicting_passes[0], replacement_allowed: false }],
    }} />);

    expect(screen.getByRole('radio', { name: /Keep Existing Pass/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Schedule New Pass/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: /Conflicts With Existing Existing Sat/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /Confirm & Generate/ }));
    expect(props.onConfirm).toHaveBeenCalledWith({ 'candidate-1': 'keep_existing' });
});
