import { describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/test-utils.jsx';
import ObservationFolderDialog from '../observation-folder-dialog.jsx';
import fixtures from '../../../../../backend/tests/fixtures/viewer.json';

const BUNDLE = 'ALFEROV_20260816_121242.gsobs';
const BASE = 'capture_iq_1';

const recording = {
    type: 'recording',
    name: BASE,
    observation_bundle: BUNDLE,
    data_file: `${BASE}.sigmf-data`,
    meta_file: `${BASE}.sigmf-meta`,
    data_size: 1536,
    meta_size: 64,
    metadata: { center_frequency: 437_025_000, sample_rate: 2_400_000 },
    snapshot: {
        filename: `${BASE}.png`,
        url: `/observations/${BUNDLE}/recordings/${BASE}.png`,
        thumbnail_url: `/observations/${BUNDLE}/recordings/${BASE}_waterfall_thumb.png?v=1`,
    },
    download_urls: {
        data: `/observations/${BUNDLE}/recordings/${BASE}.sigmf-data`,
        meta: `/observations/${BUNDLE}/recordings/${BASE}.sigmf-meta`,
    },
};

// Every file the capture owns is tagged by the backend with its owner.
const groupedArtifacts = [
    { name: `${BASE}.sigmf-data`, path: `recordings/${BASE}.sigmf-data`, url: recording.download_urls.data, size: 1536, kind: 'recording', file_type: '.sigmf-data', recording_name: BASE },
    { name: `${BASE}.sigmf-meta`, path: `recordings/${BASE}.sigmf-meta`, url: recording.download_urls.meta, size: 64, kind: 'recording', file_type: '.sigmf-meta', recording_name: BASE },
    { name: `${BASE}.png`, path: `recordings/${BASE}.png`, url: recording.snapshot.url, size: 4096, kind: 'recording', file_type: '.png', recording_name: BASE },
    { name: `${BASE}_waterfall_thumb.png`, path: `recordings/${BASE}_waterfall_thumb.png`, url: recording.snapshot.thumbnail_url, size: 512, kind: 'recording', file_type: '.png', recording_name: BASE },
];

const telemetryArtifact = {
    name: 'telemetry.bin',
    path: 'decoded/telemetry.bin',
    url: `/observations/${BUNDLE}/decoded/telemetry.bin`,
    size: 128,
    kind: 'decoded',
    file_type: '.bin',
    recording_name: null,
};

const audioArtifact = {
    name: 'downlink.wav',
    path: 'audio/downlink.wav',
    url: `/observations/${BUNDLE}/audio/downlink.wav`,
    size: 512,
    kind: 'audio',
    file_type: '.wav',
    recording_name: null,
};

const transcriptArtifact = {
    name: 'downlink.txt',
    path: 'transcriptions/downlink.txt',
    url: `/observations/${BUNDLE}/transcriptions/downlink.txt`,
    size: 64,
    kind: 'transcriptions',
    file_type: '.txt',
    recording_name: null,
};

const partialArtifact = {
    name: 'capture.part',
    path: 'snapshots/capture.part',
    url: `/observations/${BUNDLE}/snapshots/capture.part`,
    size: 32,
    kind: 'snapshots',
    file_type: '.part',
    recording_name: null,
};

const decodedImage = {
    name: 'preview.png',
    path: 'decoded/preview.png',
    url: `/observations/${BUNDLE}/decoded/preview.png`,
    size: 2048,
    kind: 'decoded',
    file_type: '.png',
    recording_name: null,
};

const folder = {
    type: 'decoded_folder',
    folder_kind: 'observation',
    foldername: BUNDLE,
    satellite_name: '239ALFEROV RS61S',
    size: 6336,
    artifact_count: groupedArtifacts.length + 5,
    recording_count: 1,
    download_url: `/api/observations/${BUNDLE}/download`,
    metadata: {
        observation_id: 'obs-1234',
        observation_name: '239ALFEROV RS61S morning pass',
        status: 'completed',
        created_at: '2026-08-16T12:12:42Z',
        finalized_at: '2026-08-16T12:20:05Z',
        satellite: { name: '239ALFEROV RS61S', norad_id: 61785 },
        sessions: [{ session_id: 'internal:obs-1234:sdr-1' }],
    },
    recordings: [recording],
    artifacts: [...groupedArtifacts, telemetryArtifact, audioArtifact, transcriptArtifact, partialArtifact, decodedImage],
    images: [
        { ...groupedArtifacts[2] },
        { ...groupedArtifacts[3] },
        decodedImage,
    ],
};

describe('ObservationFolderDialog', () => {
    it('shows telemetry badges on decoded binary rows and preserves opening the viewer', async () => {
        const socket = { connected: true, emit: vi.fn() };
        socket.timeout = vi.fn(() => socket);
        const onOpenArtifact = vi.fn();
        renderWithProviders(
            <ObservationFolderDialog open folder={folder} socket={socket} onOpenArtifact={onOpenArtifact} />
        );

        const row = screen.getByRole('button', { name: /telemetry\.bin/ });
        expect(within(row).getByText('Checking…')).toBeInTheDocument();
        expect(socket.emit).toHaveBeenCalledTimes(1);
        await act(async () => socket.emit.mock.calls[0][2](null, { success: true, data: fixtures.real.uwe4 }));
        expect(within(row).getByText('Telemetry')).toBeInTheDocument();
        expect(within(row).queryByText('Checking…')).not.toBeInTheDocument();
        expect(within(screen.getByRole('button', { name: /downlink\.wav/ })).queryByText('Telemetry')).not.toBeInTheDocument();
        await userEvent.click(row);
        expect(onOpenArtifact).toHaveBeenCalledExactlyOnceWith(telemetryArtifact);
    });

    it('shows unknown telemetry status while disconnected', () => {
        renderWithProviders(<ObservationFolderDialog open folder={folder} />);
        expect(within(screen.getByRole('button', { name: /telemetry\.bin/ })).getByText('Unknown')).toBeInTheDocument();
    });

    it('shows observation metadata before its artifacts', () => {
        renderWithProviders(
            <ObservationFolderDialog open onClose={vi.fn()} folder={folder} onOpenArtifact={vi.fn()} />
        );

        expect(screen.getByTestId('observation-details-summary')).toBeInTheDocument();
        expect(screen.getByText('239ALFEROV RS61S morning pass')).toBeInTheDocument();
        expect(screen.getByText('obs-1234')).toBeInTheDocument();
        expect(screen.getByText('61785')).toBeInTheDocument();
        expect(screen.getByText('1 session')).toBeInTheDocument();
        expect(screen.getByText('completed')).toBeInTheDocument();
    });

    it('shows the scheduled-observation snapshot stored in the bundle manifest', () => {
        const folderWithSchedule = {
            ...folder,
            metadata: {
                ...folder.metadata,
                scheduled_observation: {
                    pass: {
                        event_start: '2026-08-16T12:13:00Z',
                        event_end: '2026-08-16T12:19:00Z',
                        peak_altitude: 47.25,
                    },
                    task_start: '2026-08-16T12:12:45Z',
                    task_end: '2026-08-16T12:19:15Z',
                    actual_start_time: '2026-08-16T12:12:48Z',
                    actual_end_time: '2026-08-16T12:19:08Z',
                },
            },
        };
        renderWithProviders(
            <ObservationFolderDialog
                open
                onClose={vi.fn()}
                folder={folderWithSchedule}
            />
        );

        expect(screen.getByText('Scheduled pass')).toBeInTheDocument();
        expect(screen.getByText('47.3°')).toBeInTheDocument();
        expect(screen.getByText('Planned AOS')).toBeInTheDocument();
        expect(screen.getByText('Actual end')).toBeInTheDocument();
    });

    it('collapses each IQ capture into a single card', () => {
        renderWithProviders(
            <ObservationFolderDialog open onClose={vi.fn()} folder={folder} onOpenArtifact={vi.fn()} />
        );

        expect(screen.getAllByTestId('observation-recording-card')).toHaveLength(1);
        expect(screen.getByText(BASE)).toBeInTheDocument();
        expect(screen.getByText('1.5 KB · 437.025 MHz · 2.4 Msps')).toBeInTheDocument();

        // The capture's own files must not appear again as images or list rows.
        expect(screen.queryByText(`${BASE}.sigmf-data`)).not.toBeInTheDocument();
        expect(screen.queryByText(`${BASE}.sigmf-meta`)).not.toBeInTheDocument();
        expect(screen.queryByText(`${BASE}.png`)).not.toBeInTheDocument();
        expect(screen.queryByText(`${BASE}_waterfall_thumb.png`)).not.toBeInTheDocument();

        // Unrelated artifacts keep their own entries.
        expect(screen.getByText('preview.png')).toBeInTheDocument();
        expect(screen.getByText('telemetry.bin')).toBeInTheDocument();
    });

    it('groups each artifact type in its own section', () => {
        renderWithProviders(
            <ObservationFolderDialog open onClose={vi.fn()} folder={folder} onOpenArtifact={vi.fn()} />
        );

        expect(screen.getByText('Decoded data')).toBeInTheDocument();
        expect(screen.getByText('Audio recordings')).toBeInTheDocument();
        expect(screen.getByText('Transcripts')).toBeInTheDocument();
        expect(screen.getByText('Other files')).toBeInTheDocument();
        expect(screen.queryByText('Supporting files')).not.toBeInTheDocument();
    });

    it('derives the bundle size from detail artifacts when the compact card size is zero', () => {
        renderWithProviders(
            <ObservationFolderDialog
                open
                onClose={vi.fn()}
                folder={{ ...folder, size: 0 }}
                onOpenArtifact={vi.fn()}
            />
        );

        expect(screen.getByText('8.78 KB')).toBeInTheDocument();
    });

    it('uses the waterfall thumbnail as the recording card preview', () => {
        renderWithProviders(
            <ObservationFolderDialog open onClose={vi.fn()} folder={folder} onOpenArtifact={vi.fn()} />
        );

        expect(screen.getByAltText(BASE)).toHaveAttribute('src', recording.snapshot.thumbnail_url);
    });

    it('shows generation progress over the matching recording thumbnail', () => {
        const props = {
            open: true,
            onClose: vi.fn(),
            folder,
            onOpenArtifact: vi.fn(),
        };
        const { rerender } = renderWithProviders(
            <ObservationFolderDialog
                {...props}
                runningWaterfallPaths={new Set([`observations/${BUNDLE}/recordings/${BASE}`])}
            />
        );

        expect(screen.getByRole('status', { name: 'Generating waterfall' })).toBeInTheDocument();
        expect(screen.getByAltText(BASE)).toHaveAttribute('src', recording.snapshot.thumbnail_url);

        rerender(<ObservationFolderDialog {...props} runningWaterfallPaths={new Set()} />);
        expect(screen.queryByRole('status', { name: 'Generating waterfall' })).not.toBeInTheDocument();
    });

    it('hands the recording payload to the artifact opener when clicked', async () => {
        const onOpenArtifact = vi.fn();
        renderWithProviders(
            <ObservationFolderDialog open onClose={vi.fn()} folder={folder} onOpenArtifact={onOpenArtifact} />
        );

        await userEvent.click(screen.getByTestId('observation-recording-card'));

        expect(onOpenArtifact).toHaveBeenCalledTimes(1);
        expect(onOpenArtifact).toHaveBeenCalledWith(recording);
    });

    it('opens waterfall generation from the IQ card menu without opening recording details', async () => {
        const onOpenArtifact = vi.fn();
        const onGenerateWaterfall = vi.fn();
        renderWithProviders(
            <ObservationFolderDialog
                open
                onClose={vi.fn()}
                folder={folder}
                onOpenArtifact={onOpenArtifact}
                onGenerateWaterfall={onGenerateWaterfall}
            />
        );

        await userEvent.click(screen.getByRole('button', { name: 'Recording actions' }));
        expect(onOpenArtifact).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('menuitem', { name: 'Generate Waterfall Image' }));

        expect(onGenerateWaterfall).toHaveBeenCalledExactlyOnceWith(recording);
        expect(onOpenArtifact).not.toHaveBeenCalled();
    });

    it('offers deletion from the observation dialog footer', async () => {
        const onDelete = vi.fn();
        renderWithProviders(
            <ObservationFolderDialog open onClose={vi.fn()} folder={folder} onDelete={onDelete} />
        );

        await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('falls back to per-file entries when the payload has no grouped recordings', () => {
        const legacyFolder = {
            ...folder,
            recordings: undefined,
            recording_count: undefined,
            artifacts: [...groupedArtifacts, telemetryArtifact].map(
                ({ recording_name, ...artifact }) => artifact
            ),
            images: [{ ...groupedArtifacts[2], recording_name: undefined }],
        };

        renderWithProviders(
            <ObservationFolderDialog open onClose={vi.fn()} folder={legacyFolder} onOpenArtifact={vi.fn()} />
        );

        expect(screen.queryAllByTestId('observation-recording-card')).toHaveLength(0);
        expect(screen.getByText(`${BASE}.sigmf-data`)).toBeInTheDocument();
    });
});
