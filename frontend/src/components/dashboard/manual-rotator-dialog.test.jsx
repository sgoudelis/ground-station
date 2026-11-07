import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {afterEach, describe, expect, it, vi} from 'vitest';
import '../../i18n/config.js';
import ManualRotatorDialog from './manual-rotator-dialog.jsx';
import dashboard, {setManualRotatorDialogPosition} from './dashboard-slice.jsx';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function setup(position = {x: 0, y: 0}) {
    const store = configureStore({reducer: {dashboard}});
    store.dispatch(setManualRotatorDialogPosition(position));
    const onClose = vi.fn();
    const onMove = vi.fn();
    const gainChanged = vi.fn();
    const props = {open: true, onClose, onMove, onStop: vi.fn(), rotator: {name: 'Mount'},
        currentAz: 10, currentEl: 20, minAz: 0, maxAz: 360, minEl: 0, maxEl: 90, canStop: true};
    const ui = (open) => <Provider store={store}>
        <input aria-label="Waterfall gain" type="range" onChange={gainChanged} />
        <ManualRotatorDialog {...props} open={open} />
    </Provider>;
    const result = render(ui(true));
    const paper = screen.getByRole('dialog', {name: /Mount/});
    vi.spyOn(paper, 'getBoundingClientRect').mockReturnValue({width: 444, height: 500});
    const title = screen.getByText('Mount').closest('h2');
    title.setPointerCapture = vi.fn();
    title.hasPointerCapture = vi.fn(() => true);
    title.releasePointerCapture = vi.fn();
    return {...result, store, paper, title, onClose, onMove, gainChanged, ui};
}

describe('floating manual rotator controls', () => {
    it.each(['mouse', 'touch'])('drags with %s and restores the position when reopened', (pointerType) => {
        const {store, paper, title, rerender, ui} = setup();
        fireEvent.pointerDown(title, {pointerId: 1, pointerType, isPrimary: true, button: 0, clientX: 400, clientY: 200});
        fireEvent.pointerMove(title, {pointerId: 1, pointerType, clientX: 520, clientY: 260});
        expect(paper.style.translate).toBe('120px 60px');
        expect(store.getState().dashboard.manualRotatorDialogPosition).toEqual({x: 0, y: 0});
        fireEvent.pointerUp(title, {pointerId: 1, pointerType});
        expect(store.getState().dashboard.manualRotatorDialogPosition).toEqual({x: 120, y: 60});
        expect(title.releasePointerCapture).toHaveBeenCalledWith(1);
        rerender(ui(false));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        rerender(ui(true));
        expect(screen.getByRole('dialog').style.translate).toBe('120px 60px');
    });

    it('keeps restored positions and subsequent drags within a smaller viewport', () => {
        const {paper, title, store} = setup({x: 200, y: 80});
        vi.stubGlobal('innerWidth', 600);
        vi.stubGlobal('innerHeight', 600);
        fireEvent(window, new Event('resize'));
        expect(paper.style.translate).toBe('62px 34px');
        fireEvent.pointerDown(title, {pointerId: 1, isPrimary: true, button: 0, clientX: 400, clientY: 200});
        fireEvent.pointerMove(title, {pointerId: 1, clientX: -500, clientY: -500});
        fireEvent.pointerCancel(title, {pointerId: 1});
        expect(paper.style.translate).toBe('-62px -34px');
        expect(store.getState().dashboard.manualRotatorDialogPosition).toEqual({x: -62, y: -34});
    });

    it('leaves waterfall controls visible and focusable without closing the panel', async () => {
        const {paper, onClose, gainChanged, onMove} = setup();
        const gain = screen.getByRole('slider', {name: 'Waterfall gain'});
        expect(paper).toHaveAttribute('aria-modal', 'false');
        expect(paper).toHaveStyle({pointerEvents: 'auto'});
        expect(paper.parentElement).toHaveStyle({pointerEvents: 'none'});
        expect(document.querySelector('.MuiBackdrop-root')).not.toBeInTheDocument();
        expect(document.body.style.overflow).not.toBe('hidden');
        act(() => gain.focus());
        fireEvent.click(gain);
        fireEvent.change(gain, {target: {value: '75'}});
        await waitFor(() => expect(gain).toHaveFocus());
        expect(gainChanged).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
        expect(paper).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: /^move$/i}));
        expect(onMove).toHaveBeenCalledWith(10, 20);
    });

    it('keeps close and Escape working without starting a drag', () => {
        const {title, onClose} = setup();
        const close = screen.getByRole('button', {name: /^close$/i});
        fireEvent.pointerDown(close, {pointerId: 1, isPrimary: true, button: 0});
        fireEvent.click(close);
        expect(title.setPointerCapture).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledOnce();
        fireEvent.keyDown(close, {key: 'Escape'});
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('persists the position using the application Redux Persist configuration', async () => {
        const {store, persistor} = await import('../common/store.jsx');
        await waitFor(() => expect(persistor.getState().bootstrapped).toBe(true));
        store.dispatch(setManualRotatorDialogPosition({x: 120, y: 60}));
        await persistor.flush();
        const persisted = JSON.parse(localStorage.getItem('persist:dashboard'));
        expect(JSON.parse(persisted.manualRotatorDialogPosition)).toEqual({x: 120, y: 60});
        expect(Object.keys(persisted).sort()).toEqual(['_persist', 'manualRotatorDialogPosition']);
        store.dispatch(setManualRotatorDialogPosition({x: 0, y: 0}));
        // A fresh page receives the stored payload through Redux Persist's
        // rehydration action; verify that the application reducer restores it.
        store.dispatch({type: 'persist/REHYDRATE', key: 'dashboard', payload: Object.fromEntries(
            Object.entries(persisted).map(([key, value]) => [key, JSON.parse(value)]),
        )});
        expect(store.getState().dashboard.manualRotatorDialogPosition).toEqual({x: 120, y: 60});
        store.dispatch(setManualRotatorDialogPosition({x: 0, y: 0}));
        await persistor.flush();
        persistor.pause();
    });
});
