import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/test-utils.jsx';
import RecordingDialog from '../recording-dialog.jsx';

const recording = {
    name: 'NOAA_apt_20260101_120000',
    data_file: 'NOAA_apt_20260101_120000.sigmf-data',
    meta_file: 'NOAA_apt_20260101_120000.sigmf-meta',
    data_size: 1536,
    meta_size: 64,
    created: '2026-01-01T12:00:00Z',
    modified: '2026-01-01T12:01:00Z',
    metadata: {
        center_frequency: 137_100_000,
        sample_rate: 2_400_000,
        start_time: '2026-01-01T12:00:00Z',
        finalized_time: '2026-01-01T12:01:00Z',
    },
    snapshot: {
        filename: 'NOAA_apt_20260101_120000.png',
        url: '/recordings/NOAA_apt_20260101_120000.png',
        thumbnail_url: '/recordings/thumbnails/NOAA_apt_20260101_120000.jpg?v=1',
        width: 640,
        height: 360,
        size: 2048,
        thumbnail: {
            filename: 'NOAA_apt_20260101_120000.jpg',
            url: '/recordings/thumbnails/NOAA_apt_20260101_120000.jpg?v=1',
            size: 512,
            width: 320,
            height: 180,
        },
    },
    download_urls: {
        data: '/recordings/NOAA_apt_20260101_120000.sigmf-data',
        meta: '/recordings/NOAA_apt_20260101_120000.sigmf-meta',
    },
};

describe('RecordingDialog', () => {
    it('shows associated recording files with thumbnails and sizes', () => {
        renderWithProviders(
            <RecordingDialog
                open
                onClose={vi.fn()}
                recording={recording}
            />
        );

        expect(screen.getByText('IQ Data')).toBeInTheDocument();
        expect(screen.getByText('NOAA_apt_20260101_120000.sigmf-data')).toBeInTheDocument();
        expect(screen.getAllByText('1.5 KB').length).toBeGreaterThan(0);

        expect(screen.getAllByText('Metadata').length).toBeGreaterThan(0);
        expect(screen.getByText('NOAA_apt_20260101_120000.sigmf-meta')).toBeInTheDocument();
        expect(screen.getByText('64 Bytes')).toBeInTheDocument();

        expect(screen.getByText('Waterfall Snapshot')).toBeInTheDocument();
        expect(screen.getByText('NOAA_apt_20260101_120000.png')).toBeInTheDocument();
        expect(screen.getAllByText('640×360').length).toBeGreaterThan(0);
        expect(screen.getByText('2 KB')).toBeInTheDocument();

        expect(screen.getByText('Thumbnail')).toBeInTheDocument();
        expect(screen.getByText('NOAA_apt_20260101_120000.jpg')).toBeInTheDocument();
        expect(screen.getByText('320×180')).toBeInTheDocument();
        expect(screen.getByText('512 Bytes')).toBeInTheDocument();
        expect(screen.getAllByAltText('Thumbnail preview')).toHaveLength(1);
    });
});
