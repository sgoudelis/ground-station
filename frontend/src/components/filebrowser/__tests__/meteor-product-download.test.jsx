import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils.jsx';
import MeteorHrptFolderDialog from '../meteor-hrpt-folder-dialog.jsx';
import MeteorM2xLrptFolderDialog from '../meteor-m2x-lrpt-folder-dialog.jsx';

afterEach(() => vi.restoreAllMocks());

describe.each([MeteorHrptFolderDialog, MeteorM2xLrptFolderDialog])('Meteor product download', (Viewer) => {
    it.each([undefined, '/api/observations/METEOR.gsobs/download?product=decoded%2Fcapture.satdump_meteor_hrpt'])(
        'uses the server download URL when provided: %s', (downloadUrl) => {
            const open = vi.spyOn(window, 'open').mockImplementation(() => null);
            renderWithProviders(<Viewer open onClose={vi.fn()} folder={{
                foldername: 'capture.satdump_meteor_hrpt', image_count: 1,
                images: [{ filename: 'MSU-MR-1.png', url: '/product/image.png', size: 12 }],
                download_url: downloadUrl,
            }} />);
            fireEvent.click(screen.getByRole('button', { name: /DOWNLOAD ZIP/i }));
            expect(open).toHaveBeenCalledWith(downloadUrl || '/api/decoded/capture.satdump_meteor_hrpt/download', '_blank');
        },
    );
});
