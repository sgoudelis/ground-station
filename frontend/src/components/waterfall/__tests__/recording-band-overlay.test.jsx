import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/test-utils.jsx';
import RecordingBandOverlay from '../recording-band-overlay.jsx';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (_key, defaultValue) => defaultValue }),
}));

const canvasContext = {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    restore: vi.fn(),
    roundRect: vi.fn(),
    save: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('RecordingBandOverlay drag handling', () => {
    it('keeps its drag target aligned and converts screen movement using the zoomed bandwidth', () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 400 });
        const onCenterOffsetChange = vi.fn();
        renderWithProviders(<RecordingBandOverlay
            inputSampleRate={2_400_000} decimationFactor={8} selectionEnabled
            containerWidth={400} height={200} viewport={{ width: 400, scale: 4, positionX: -600 }}
            onCenterOffsetChange={onCenterOffsetChange}
        />);

        const dragHandle = screen.getByLabelText('Drag recording band');
        expect(dragHandle).toHaveStyle({ left: '100px', width: '200px' });
        fireEvent.mouseDown(dragHandle, { clientX: 100 });
        fireEvent.mouseMove(document, { clientX: 200 });
        fireEvent.mouseUp(document);
        expect(onCenterOffsetChange).toHaveBeenCalledWith(150_000);
    });

    it('keeps a recording-band drag from reaching the bandscope pan handlers', () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            width: 400,
            height: 200,
            top: 0,
            left: 0,
            right: 400,
            bottom: 200,
            x: 0,
            y: 0,
            toJSON: () => {},
        });

        const onCenterOffsetChange = vi.fn();
        renderWithProviders(
            <RecordingBandOverlay
                inputSampleRate={2_400_000}
                decimationFactor={2}
                selectionEnabled
                containerWidth={400}
                height={200}
                onCenterOffsetChange={onCenterOffsetChange}
            />,
        );

        const dragHandle = screen.getByLabelText('Drag recording band');
        const bandscopePanStart = vi.fn();
        const bandscopePanMove = vi.fn();
        dragHandle.parentElement.addEventListener('mousedown', bandscopePanStart);
        window.addEventListener('mousemove', bandscopePanMove);

        fireEvent.mouseDown(dragHandle, { clientX: 100 });
        fireEvent.mouseMove(dragHandle, { clientX: 200 });

        expect(bandscopePanStart).not.toHaveBeenCalled();
        expect(bandscopePanMove).not.toHaveBeenCalled();
        expect(onCenterOffsetChange).toHaveBeenCalledWith(600_000);

        window.removeEventListener('mousemove', bandscopePanMove);
    });
});
