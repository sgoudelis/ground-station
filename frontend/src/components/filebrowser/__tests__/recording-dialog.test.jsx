import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
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
    it('keeps survey waterfalls viewable without offering deleted IQ downloads', () => {
        renderWithProviders(<RecordingDialog open onClose={vi.fn()} recording={{
            ...recording,
            iq_data_deleted: true,
            data_file: null,
            data_size: 0,
            download_urls: { meta: recording.download_urls.meta },
        }} />);

        expect(screen.getByTestId('waterfall-viewer')).toBeInTheDocument();
        expect(screen.getByText('Waterfall only')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('IQ samples were deleted');
        expect(screen.queryByText('IQ Data')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Download Data' })).not.toBeInTheDocument();
        for (const button of screen.getAllByRole('button', { name: /Download (Metadata|Snapshot)/ })) {
            expect(button).toBeEnabled();
        }
        expect(screen.getByText('Download Snapshot', { selector: 'button' })).toBeEnabled();
    });

    it('loads transmitter annotations from the recording target NORAD ID', () => {
        const socket = { emit: vi.fn() };
        const targetedRecording = {
            ...recording,
            metadata: { ...recording.metadata, target_satellite_norad_id: '25338' },
        };
        renderWithProviders(<RecordingDialog open onClose={vi.fn()} recording={targetedRecording} socket={socket} />);

        expect(socket.emit).toHaveBeenCalledWith('api.call', {
            cmd: 'get-transmitters',
            data: { norad_cat_id: 25338 },
        }, expect.any(Function));
        act(() => {
            socket.emit.mock.calls[0][2]({
                success: true,
                data: [{ id: 'tx', description: 'APT', downlink_low: 137_100_000 }],
            });
        });
        expect(screen.getByTestId('waterfall-transmitter-strip')).toBeInTheDocument();
    });

    it('does not request or show transmitters when recording metadata has no target', () => {
        const socket = { emit: vi.fn() };
        renderWithProviders(<RecordingDialog open onClose={vi.fn()} recording={recording} socket={socket} />);
        expect(socket.emit).not.toHaveBeenCalled();
        expect(screen.queryByTestId('waterfall-transmitter-strip')).not.toBeInTheDocument();
    });

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
        expect(screen.getByText('2 KB · 640×360')).toBeInTheDocument();

        expect(screen.getByText('Thumbnail')).toBeInTheDocument();
        expect(screen.getByText('NOAA_apt_20260101_120000.jpg')).toBeInTheDocument();
        expect(screen.getByText('512 Bytes · 320×180')).toBeInTheDocument();
        expect(screen.getAllByAltText('Thumbnail preview')).toHaveLength(1);
    });
});
