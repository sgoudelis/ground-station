import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils.jsx';
import ProcessingDialog from '../processing-dialog.jsx';

const { socket } = vi.hoisted(() => ({ socket: { emit: vi.fn() } }));
vi.mock('../../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
    socket.emit.mockReset();
    socket.emit.mockImplementation((_event, _request, reply) => reply({ success: true, task_id: 'job' }));
});

describe('file browser SatDump processing destination', () => {
    it.each([null, '/observations/METEOR.gsobs/recordings/capture.sigmf-data'])(
        'submits the source and product path for server-side routing with input %s', async (dataUrl) => {
            const store = configureStore({ reducer: { backgroundTasks: () => ({ tasks: {} }) } });
            renderWithProviders(<ProcessingDialog open onClose={vi.fn()} recording={{
                name: 'capture', metadata: { sample_rate: 1000000 },
                ...(dataUrl ? { download_urls: { data: dataUrl } } : {}),
            }} />, { store });
            fireEvent.click(screen.getByRole('button', { name: 'Start Processing' }));
            await waitFor(() => expect(socket.emit).toHaveBeenCalledOnce());
            const request = socket.emit.mock.calls[0][1];
            expect(request.cmd).toBe('background-task.start');
            expect(request.data.args).toEqual([
                dataUrl || '/recordings/capture.sigmf-data',
                '/decoded/capture.satdump_meteor_m2-x_lrpt',
                'meteor_m2-x_lrpt',
            ]);
            expect(request.data.kwargs).not.toHaveProperty('observation_bundle');
        },
    );

    it.each([
        ['/recordings/capture%20IQ.sigmf-data', 'Standalone processing'],
        ['/observations/METEOR.gsobs/recordings/capture%20IQ.sigmf-data?v=1', 'Observation processing'],
    ])('restores the correct running job for %s when reopened', (dataUrl, taskName) => {
        const tasks = {
            unrelated: { name: 'Other task', args: ['100% complete'] },
            standalone: {
                name: 'Standalone processing', status: 'running', start_time: 1,
                args: ['/srv/backend/data/recordings/capture IQ.sigmf-data'],
            },
            observation: {
                name: 'Observation processing', status: 'running', start_time: 2,
                args: ['/srv/backend/data/observations/METEOR.gsobs/recordings/capture IQ.sigmf-data'],
            },
            other: {
                name: 'Other observation processing', status: 'running', start_time: 3,
                args: ['/srv/backend/data/observations/OTHER.gsobs/recordings/capture IQ.sigmf-data'],
            },
        };
        const store = configureStore({ reducer: { backgroundTasks: () => ({ tasks }) } });
        renderWithProviders(<ProcessingDialog open onClose={vi.fn()} recording={{
            name: 'capture IQ', metadata: { sample_rate: 1000000 },
            download_urls: { data: dataUrl },
        }} />, { store });

        expect(screen.getByText(taskName)).toBeInTheDocument();
        expect(screen.queryByText('Other observation processing')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Start Processing' })).toBeDisabled();
        expect(socket.emit).not.toHaveBeenCalled();
    });
});
