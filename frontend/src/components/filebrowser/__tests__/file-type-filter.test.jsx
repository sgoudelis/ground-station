import { expect, test, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/test-utils.jsx';
import FileTypeFilter from '../file-type-filter.jsx';

test('opens a type checklist with a live count and bulk controls', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onSetAll = vi.fn();
    const filters = {
        showRecordings: true,
        showSnapshots: false,
        showDecoded: true,
        showObservations: true,
        showRadiosondes: true,
        showAircraft: false,
        showMeshtastic: true,
        showAudio: false,
        showTranscriptions: false,
    };
    const { rerender } = renderWithProviders(
        <FileTypeFilter filters={filters} onToggle={onToggle} onSetAll={onSetAll} />
    );

    await user.click(screen.getByRole('button', { name: /Filter 5\/9/i }));
    expect(screen.getByRole('dialog', { name: 'Filter' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Observations' })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Observations' }));
    expect(onToggle).toHaveBeenCalledWith('showObservations');
    expect(screen.getByRole('checkbox', { name: 'Weather balloons' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Aircraft' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Weather balloons' }));
    expect(onToggle).toHaveBeenCalledWith('showRadiosondes');
    await user.click(screen.getByRole('checkbox', { name: 'Aircraft' }));
    expect(onToggle).toHaveBeenCalledWith('showAircraft');
    expect(screen.getByRole('checkbox', { name: 'Meshtastic nodes' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Meshtastic nodes' }));
    expect(onToggle).toHaveBeenCalledWith('showMeshtastic');
    await user.click(screen.getByRole('button', { name: 'Select All' }));
    expect(onSetAll).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onSetAll).toHaveBeenCalledWith(false);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filter' })).not.toBeInTheDocument());
    rerender(<FileTypeFilter filters={{ ...filters, showObservations: false }} onToggle={onToggle} onSetAll={onSetAll} />);
    expect(screen.getByRole('button', { name: /Filter 4\/9/i })).toBeInTheDocument();
});
