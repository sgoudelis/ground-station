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
        'always produces a shared decoded folder with input %s', async (dataUrl) => {
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
});
