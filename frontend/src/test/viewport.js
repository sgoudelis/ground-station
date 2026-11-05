import {vi} from 'vitest';

// JSDOM does not evaluate media queries. Match MUI's min/max width queries so
// responsive tests exercise the same column decisions as a browser viewport.
export function mockViewport(width) {
    window.matchMedia = vi.fn((query) => {
        const minimum = query.match(/min-width:\s*([\d.]+)px/);
        const maximum = query.match(/max-width:\s*([\d.]+)px/);
        return {
            matches: (!minimum || width >= Number(minimum[1])) && (!maximum || width <= Number(maximum[1])),
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        };
    });
}
