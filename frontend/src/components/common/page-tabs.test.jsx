import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PageTabsLayout from './page-tabs.jsx';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

it('keeps nested tab rows below their parent as its height changes', () => {
    const observers = new Map();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { this.callback = callback; }
        observe(element) { observers.set(element, this.callback); }
        disconnect = disconnect;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        return { height: Number(this.firstElementChild?.dataset.height || 0) };
    });

    const { unmount } = render(
        <PageTabsLayout tabs={<div data-height="49">Main tabs</div>}>
            <PageTabsLayout tabs={<div data-height="49">Detail tabs</div>}>
                Content
            </PageTabsLayout>
        </PageTabsLayout>,
    );
    const mainRow = screen.getByText('Main tabs').parentElement;
    const detailRow = screen.getByText('Detail tabs').parentElement;
    expect(mainRow).toHaveStyle({ position: 'sticky', top: 'var(--AppBar-height, 52px)' });
    expect(detailRow).toHaveStyle({ position: 'sticky', top: 'calc(var(--AppBar-height, 52px) + 49px)' });

    // A taller label or browser font change must move the second row down too.
    screen.getByText('Main tabs').dataset.height = '72';
    act(() => observers.get(mainRow)());
    expect(detailRow).toHaveStyle({ top: 'calc(var(--AppBar-height, 52px) + 72px)' });

    unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
});

it('passes the offset through layouts with no tab row', () => {
    render(
        <PageTabsLayout>
            <PageTabsLayout tabs={<div>Tabs</div>}>Content</PageTabsLayout>
        </PageTabsLayout>,
    );
    expect(screen.getByText('Tabs').parentElement).toHaveStyle({ top: 'var(--AppBar-height, 52px)' });
});
