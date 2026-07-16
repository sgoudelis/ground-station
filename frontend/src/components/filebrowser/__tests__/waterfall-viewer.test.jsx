import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/test-utils.jsx';
import WaterfallViewer from '../waterfall-viewer.jsx';

vi.mock('../../waterfall/frequency-scale.jsx', () => ({
    default: ({ interactionActive = false, allowInteractionMeasure = false }) => (
        <div
            data-testid="frequency-scale"
            data-interaction-active={String(interactionActive)}
            data-allow-interaction-measure={String(allowInteractionMeasure)}
        />
    ),
}));

const renderViewer = () => renderWithProviders(
    <WaterfallViewer
        src="/waterfall.png"
        alt="Recorded waterfall"
        centerFrequency={145_800_000}
        sampleRate={2_400_000}
    />
);

const mockViewerRect = () => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 240,
    top: 0,
    left: 0,
    right: 400,
    bottom: 240,
    x: 0,
    y: 0,
    toJSON: () => {},
});

const stubPointerCapture = (viewer) => {
    viewer.setPointerCapture = vi.fn();
    viewer.hasPointerCapture = vi.fn(() => false);
    viewer.releasePointerCapture = vi.fn();
};

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('WaterfallViewer drag handling', () => {
    it('shows a loading indicator until the snapshot image loads', () => {
        renderViewer();
        expect(screen.getByRole('progressbar')).toBeInTheDocument();

        fireEvent.load(screen.getByAltText('Recorded waterfall'));
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    it('cancels native drag events from the rendered waterfall image', () => {
        renderViewer();

        const image = screen.getByAltText('Recorded waterfall');

        expect(fireEvent.dragStart(image)).toBe(false);
    });

    it('prevents the browser default on mouse pointer down inside the viewer', () => {
        const setPointerCapture = vi.fn();
        const hasPointerCapture = vi.fn(() => false);
        const viewer = renderViewer().getByTestId('waterfall-viewer');

        viewer.setPointerCapture = setPointerCapture;
        viewer.hasPointerCapture = hasPointerCapture;

        const pointerDown = new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: 'mouse',
            button: 0,
            clientX: 120,
            clientY: 80,
        });

        viewer.dispatchEvent(pointerDown);

        expect(pointerDown.defaultPrevented).toBe(true);
        expect(setPointerCapture).toHaveBeenCalledWith(1);
    });

    it('places the crosshair on click and leaves it fixed through move and leave', () => {
        mockViewerRect();
        const viewer = renderViewer().getByTestId('waterfall-viewer');
        stubPointerCapture(viewer);

        act(() => {
            viewer.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'mouse',
                button: 0,
                clientX: 200,
                clientY: 120,
            }));
            viewer.dispatchEvent(new PointerEvent('pointerup', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'mouse',
                button: 0,
                clientX: 200,
                clientY: 120,
            }));
        });

        expect(screen.getByText('145.800000 MHz')).toBeInTheDocument();

        act(() => {
            viewer.dispatchEvent(new PointerEvent('pointermove', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'mouse',
                clientX: 100,
                clientY: 120,
            }));
            viewer.dispatchEvent(new PointerEvent('pointerleave', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'mouse',
                clientX: 100,
                clientY: 120,
            }));
        });

        expect(screen.getByText('145.800000 MHz')).toBeInTheDocument();
        expect(screen.queryByText('145.200000 MHz')).not.toBeInTheDocument();
    });

    it('repositions the crosshair on another click', () => {
        mockViewerRect();
        const viewer = renderViewer().getByTestId('waterfall-viewer');
        stubPointerCapture(viewer);

        act(() => {
            viewer.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'mouse',
                button: 0,
                clientX: 200,
                clientY: 120,
            }));
            viewer.dispatchEvent(new PointerEvent('pointerup', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'mouse',
                button: 0,
                clientX: 200,
                clientY: 120,
            }));
            viewer.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                pointerId: 2,
                pointerType: 'mouse',
                button: 0,
                clientX: 100,
                clientY: 120,
            }));
            viewer.dispatchEvent(new PointerEvent('pointerup', {
                bubbles: true,
                cancelable: true,
                pointerId: 2,
                pointerType: 'mouse',
                button: 0,
                clientX: 100,
                clientY: 120,
            }));
        });

        expect(screen.getByText('145.200000 MHz')).toBeInTheDocument();
        expect(screen.queryByText('145.800000 MHz')).not.toBeInTheDocument();
    });

    it('keeps the crosshair anchored to the same frequency while zooming', () => {
        mockViewerRect();
        const viewer = renderViewer().getByTestId('waterfall-viewer');
        stubPointerCapture(viewer);

        act(() => {
            viewer.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'mouse',
                button: 0,
                clientX: 100,
                clientY: 120,
            }));
            viewer.dispatchEvent(new PointerEvent('pointerup', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'mouse',
                button: 0,
                clientX: 100,
                clientY: 120,
            }));
        });

        const crosshair = screen.getByTestId('waterfall-crosshair-vertical');
        expect(crosshair.style.left).toBe('100px');
        expect(screen.getByText('145.200000 MHz')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Zoom In X'));

        expect(crosshair.style.left).toBe('50px');
        expect(screen.getByText('145.200000 MHz')).toBeInTheDocument();
    });

    it('renders a faint center-frequency marker line', () => {
        mockViewerRect();
        renderViewer();

        const marker = screen.getByTestId('waterfall-center-frequency-line');
        expect(marker).toBeInTheDocument();
        expect(marker.style.left).toBe('200px');
    });

    it('places the crosshair on a touch tap', () => {
        mockViewerRect();
        const viewer = renderViewer().getByTestId('waterfall-viewer');
        stubPointerCapture(viewer);

        act(() => {
            viewer.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'touch',
                clientX: 200,
                clientY: 120,
            }));
            viewer.dispatchEvent(new PointerEvent('pointerup', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'touch',
                clientX: 200,
                clientY: 120,
            }));
        });

        expect(screen.getByText('145.800000 MHz')).toBeInTheDocument();
    });

    it('keeps touch movement from showing the mouse crosshair', () => {
        mockViewerRect();
        const viewer = renderViewer().getByTestId('waterfall-viewer');
        stubPointerCapture(viewer);

        act(() => {
            viewer.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'touch',
                clientX: 120,
                clientY: 90,
            }));
            viewer.dispatchEvent(new PointerEvent('pointermove', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'touch',
                clientX: 150,
                clientY: 95,
            }));
        });

        expect(screen.queryByText('145.500000 MHz')).not.toBeInTheDocument();
    });

    it('zooms the X axis with a two-finger touch pinch', () => {
        mockViewerRect();
        const viewer = renderViewer().getByTestId('waterfall-viewer');
        stubPointerCapture(viewer);

        act(() => {
            viewer.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'touch',
                clientX: 100,
                clientY: 100,
            }));
            viewer.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                pointerId: 2,
                pointerType: 'touch',
                clientX: 200,
                clientY: 100,
            }));
            viewer.dispatchEvent(new PointerEvent('pointermove', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'touch',
                clientX: 50,
                clientY: 100,
            }));
            viewer.dispatchEvent(new PointerEvent('pointermove', {
                bubbles: true,
                cancelable: true,
                pointerId: 2,
                pointerType: 'touch',
                clientX: 250,
                clientY: 100,
            }));
        });

        expect(screen.getByText('Zoom 2.0x')).toBeInTheDocument();
    });

    it('pauses frequency scale measurement while a touch pinch transform is active', () => {
        vi.useFakeTimers();
        mockViewerRect();
        const viewer = renderViewer().getByTestId('waterfall-viewer');
        stubPointerCapture(viewer);

        expect(screen.getByTestId('frequency-scale')).toHaveAttribute('data-interaction-active', 'false');

        act(() => {
            viewer.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'touch',
                clientX: 100,
                clientY: 100,
            }));
            viewer.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                pointerId: 2,
                pointerType: 'touch',
                clientX: 200,
                clientY: 100,
            }));
            viewer.dispatchEvent(new PointerEvent('pointermove', {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'touch',
                clientX: 50,
                clientY: 100,
            }));
        });

        expect(screen.getByTestId('frequency-scale')).toHaveAttribute('data-interaction-active', 'true');
        expect(screen.getByTestId('frequency-scale')).toHaveAttribute('data-allow-interaction-measure', 'false');

        act(() => {
            vi.advanceTimersByTime(130);
        });

        expect(screen.getByTestId('frequency-scale')).toHaveAttribute('data-interaction-active', 'false');
    });
});
