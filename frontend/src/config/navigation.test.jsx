import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { Saturn01Icon } from 'hugeicons-react';
import { getCelestialDataIconStatus, getNavigation } from './navigation.jsx';

describe('administration navigation', () => {
    it('groups satellite and celestial pages under their domain parents', () => {
        const navigation = getNavigation({ isAdmin: true });
        const satelliteData = navigation.find((item) => item.segment === 'admin/satellites');
        const celestialData = navigation.find((item) => item.segment === 'admin/celestial');

        expect(satelliteData.children.map((item) => item.segment)).toEqual([
            'orbital-data',
            'sources',
            'catalog',
            'groups',
        ]);
        expect(celestialData.children.map((item) => item.segment)).toEqual([
            'ephemeris',
            'catalog',
        ]);
        expect(celestialData.collapsedSegment).toBe('admin/celestial/ephemeris');
        expect(navigation.some((item) => item.segment === 'admin/satellites/catalog')).toBe(false);
        expect(navigation.some((item) => item.segment === 'admin/celestial/catalog')).toBe(false);
    });

    it('does not expose administration groups to non-admin users', () => {
        const navigation = getNavigation({ isAdmin: false });

        expect(navigation.some((item) => item.segment === 'admin/satellites')).toBe(false);
        expect(navigation.some((item) => item.segment === 'admin/celestial')).toBe(false);
        expect(navigation.some((item) => item.segment?.startsWith('admin/system'))).toBe(false);
    });

    it('separates System settings, maintenance pages and About', () => {
        const navigation = getNavigation({ isAdmin: true });
        const system = navigation.filter((item) => item.segment?.startsWith('admin/system'));
        expect(system.map((item) => item.title)).toEqual(['Settings', 'Maintenance', 'About']);
        expect(system[0].children.map((item) => item.segment)).toEqual([
            'general', 'hardware', 'location', 'users', 'feedback',
        ]);
        expect(system[1].children.map((item) => item.segment)).toEqual([
            'updates', 'frontend-state', 'sessions', 'message-log',
            'diagnostics', 'dependencies', 'system', 'database',
        ]);
        expect(system[0].collapsedSegment).toBe('admin/system/general');
        expect(system[1].collapsedSegment).toBe('admin/system/maintenance/updates');
        expect(system[2].children).toBeUndefined();
    });

    it('uses a planet icon for celestial data administration and its catalog child', () => {
        const navigation = getNavigation({ isAdmin: true });
        const celestialData = navigation.find((item) => item.segment === 'admin/celestial');
        const catalogChild = celestialData.children.find((item) => item.segment === 'catalog');

        expect(catalogChild.icon.type).toBe(Saturn01Icon);

        const store = configureStore({
            reducer: {
                celestial: () => ({}),
            },
        });
        const { container } = render(
            <Provider store={store}>
                {celestialData.icon}
            </Provider>
        );
        expect(container.querySelector('svg')).toBeInTheDocument();
    });
});

describe('celestial data navigation status', () => {
    it('shows the working overlay while ephemeris synchronization is active', () => {
        expect(getCelestialDataIconStatus({
            ephemerisSync: { status: 'inprogress' },
        })).toEqual({ showOverlay: true, overlayType: 'sync' });
    });

    it('shows the error overlay for a failed sync or unavailable provider', () => {
        expect(getCelestialDataIconStatus({
            ephemerisSync: { status: 'failed' },
        })).toEqual({ showOverlay: true, overlayType: 'error' });

        expect(getCelestialDataIconStatus({
            ephemerisSync: {
                status: 'idle',
                providerStatus: { availability: 'unavailable' },
            },
        })).toEqual({ showOverlay: true, overlayType: 'error' });
    });

    it('removes the overlay after a successful synchronization', () => {
        expect(getCelestialDataIconStatus({
            ephemerisSync: {
                status: 'complete',
                providerStatus: { availability: 'available' },
            },
        })).toEqual({ showOverlay: false, overlayType: 'error' });
    });
});

describe('tracking navigation status', () => {
    it('overlays rotator and rig badges and describes both in the tooltip', () => {
        const now = Date.now();
        const store = configureStore({
            reducer: {
                dashboard: () => ({ connected: true }),
                trackerInstances: () => ({ instances: [{ tracker_id: 'target-1', rotator_id: 'rot-1', rig_id: 'rig-1' }] }),
                targetSatTrack: () => ({ trackerViews: {
                    'target-1': {
                        hardwareObservedAt: now,
                        hardwareReceivedAt: now,
                        rotatorData: { connected: true, slewing: true },
                        rigData: { connected: true, tracking: true },
                    },
                } }),
            },
        });
        const tracking = getNavigation().find((item) => item.segment === 'tracking');

        const { container } = render(<Provider store={store}>{tracking.icon}{tracking.tooltip}</Provider>);
        expect(container.querySelector('[data-testid="tracking-rotator-status"]')).toHaveAttribute('data-status', 'slewing');
        expect(container.querySelector('[data-testid="tracking-rig-status"]')).toHaveAttribute('data-status', 'tracking');
        expect(container).toHaveTextContent('Rotator: Slewing');
        expect(container).toHaveTextContent('Rig: Tracking');
    });
});

describe('scheduler navigation status', () => {
    function renderScheduler(scheduled = [], continuous = []) {
        const store = configureStore({ reducer: {
            scheduler: (state = { observations: scheduled }) => state,
            continuousObservations: (state = { definitions: continuous }, action) => (
                action.type === 'continuous/update' ? { definitions: action.payload } : state
            ),
            preferences: () => ({ preferences: [
                { name: 'timezone', value: 'UTC' }, { name: 'locale', value: 'en-GB' },
            ] }),
        } });
        const scheduler = getNavigation().find((item) => item.segment === 'scheduler');
        return { store, ...render(<Provider store={store}>{scheduler.icon}{scheduler.tooltip}</Provider>) };
    }

    it('shows both observation types independently and updates as a continuous run changes', () => {
        const { container, store } = renderScheduler([{ status: 'running' }], [
            { runtime: { status: 'running' } },
        ]);
        expect(container.querySelector('[data-testid="ManageHistoryIcon"]')).toBeInTheDocument();
        expect(container.querySelector('[data-overlay="play"]')).toHaveStyle({ right: '-6px' });
        expect(container.querySelector('.MuiBadge-badge:not(.MuiBadge-invisible)')).toHaveTextContent('1');
        expect(container.querySelector('.MuiBadge-badge')).toHaveAttribute('aria-label', '1 continuous observation running');

        for (const [status, overlay] of [['stopping', 'spinner'], ['stopped', null], ['starting', 'spinner'], ['running', 'continuous'], ['failed', 'error']]) {
            act(() => store.dispatch({ type: 'continuous/update', payload: [{ runtime: { status } }] }));
            expect(container.querySelector('[data-overlay="play"]')).toBeInTheDocument();
            expect(container.querySelectorAll('[data-overlay]')).toHaveLength(overlay && overlay !== 'continuous' ? 2 : 1);
            expect(container.querySelector('.MuiBadge-badge')).toHaveAttribute('aria-hidden', String(overlay !== 'continuous'));
            if (overlay === 'continuous') {
                expect(container.querySelector('.MuiBadge-badge:not(.MuiBadge-invisible)')).toHaveTextContent('1');
            } else if (overlay) {
                expect(container.querySelector(`[data-overlay="${overlay}"]`)).toHaveStyle({ left: '-6px' });
            }
        }
    });

    it('does not treat auto-start preferences or stopped definitions as running', () => {
        const { container } = renderScheduler([{ status: 'scheduled', enabled: true }], [
            { auto_start: true },
            { auto_start: true, runtime: { status: 'not_started' } },
            { auto_start: true, runtime: { status: 'stopped' } },
        ]);
        expect(container.querySelector('[data-overlay]')).toBeNull();
        expect(container.querySelector('.MuiBadge-badge')).toHaveClass('MuiBadge-invisible');
        expect(container).toHaveTextContent('Scheduler');
        expect(container).not.toHaveTextContent('running');
    });

    it('prioritizes the latest failure and transitions while retaining running counts', () => {
        const { container, store } = renderScheduler([
            { status: 'failed', task_start: '2026-01-03T00:00:00Z' },
            { status: 'running', task_start: '2026-01-01T00:00:00Z' },
        ], [
            { runtime: { status: 'failed', active: true, attempted_at: '2026-01-03T00:00:00Z' } },
            { runtime: { status: 'running', attempted_at: '2026-01-01T00:00:00Z' } },
            { runtime: { status: 'starting', attempted_at: '2026-01-02T00:00:00Z' } },
        ]);
        expect(container.querySelectorAll('[data-overlay="error"]')).toHaveLength(2);
        expect(container.querySelector('.MuiBadge-badge:not(.MuiBadge-invisible)')).toBeNull();
        expect(container).toHaveTextContent('1 scheduled observation failed');
        expect(container).toHaveTextContent('1 continuous observation failed');
        expect(container).toHaveTextContent('1 continuous observation starting');
        expect(container).toHaveTextContent('1 continuous observation running');

        act(() => store.dispatch({ type: 'continuous/update', payload: [
            { runtime: { status: 'running' } }, { runtime: { status: 'starting' } },
        ] }));
        expect(container.querySelector('[data-overlay="spinner"]')).toHaveStyle({ left: '-6px' });
        expect(container.querySelector('[data-overlay="error"]')).toHaveStyle({ right: '-6px' });
    });

    it.each(['running', 'completed'])('hides an older scheduled failure after a newer %s run', (status) => {
        const { container } = renderScheduler([
            { status, actual_start_time: '2026-01-02T00:00:00Z' },
            // Editing an old failure must not make it the latest executed observation.
            { status: 'failed', task_start: '2026-01-01T00:00:00Z', updated_at: '2026-01-04T00:00:00Z' },
            { status: 'scheduled', task_start: '2099-01-01T00:00:00Z' },
        ]);
        expect(container.querySelector('[data-overlay="error"]')).toBeNull();
        expect(container.querySelector('[data-overlay="play"]') !== null).toBe(status === 'running');
        expect(container).not.toHaveTextContent('observation failed');
    });

    it.each(['running', 'stopped'])('hides an older continuous failure after a newer %s run', (status) => {
        const { container } = renderScheduler([], [
            { runtime: { status, attempted_at: '2026-01-02T00:00:00Z' } },
            { updated_at: '2026-01-04T00:00:00Z', runtime: { status: 'failed', attempted_at: '2026-01-01T00:00:00Z' } },
            { auto_start: true, runtime: { status: 'not_started' } },
        ]);
        expect(container.querySelector('[data-overlay="error"]')).toBeNull();
        expect(container.querySelector('.MuiBadge-badge:not(.MuiBadge-invisible)') !== null).toBe(status === 'running');
        expect(container).not.toHaveTextContent('observation failed');
    });

    it('shows only the latest failure even when future passes or other failed runs exist', () => {
        const { container } = renderScheduler([
            { status: 'failed', pass: { event_start: '2026-01-02T00:00:00Z' } },
            { status: 'failed', task_start: '2026-01-01T00:00:00Z' },
            { status: 'scheduled', enabled: true, task_start: '2099-01-01T00:00:00Z' },
        ], [
            { runtime: { status: 'failed', attempted_at: '2026-01-02T00:00:00Z', started_at: null } },
            { runtime: { status: 'running', started_at: '2026-01-01T00:00:00Z' } },
        ]);
        expect(container.querySelectorAll('[data-overlay="error"]')).toHaveLength(2);
        expect(container).toHaveTextContent('1 scheduled observation failed');
        expect(container).not.toHaveTextContent('2 scheduled observations failed');
        expect(container).toHaveTextContent('1 continuous observation failed');
    });

    it('keeps scheduled pass details alongside plural continuous counts', () => {
        const now = Date.now();
        const { container } = renderScheduler([
            { status: 'running', satellite: { name: 'Current pass' }, task_end: new Date(now + 600000).toISOString() },
            { status: 'scheduled', enabled: true, satellite: { name: 'Next pass' }, task_start: new Date(now + 1200000).toISOString() },
            { status: 'scheduled', enabled: false, satellite: { name: 'Disabled pass' }, task_start: new Date(now + 60000).toISOString() },
            { status: 'scheduled', enabled: true, satellite: { name: 'Past pass' }, task_start: new Date(now - 60000).toISOString() },
        ], [{ runtime: { status: 'running' } }, { runtime: { status: 'running' } }]);

        expect(container).toHaveTextContent('2 continuous observations running');
        expect(container.querySelector('.MuiBadge-badge:not(.MuiBadge-invisible)')).toHaveTextContent('2');
        expect(container).toHaveTextContent('Active: Current pass');
        expect(container).toHaveTextContent('left, ends');
        expect(container).toHaveTextContent('Next: Next pass');
        expect(container).toHaveTextContent('starts');
        expect(container).not.toHaveTextContent('Disabled pass');
        expect(container).not.toHaveTextContent('Past pass');
    });
});

describe('file browser navigation status', () => {
    it('shows new files away from Files and hides the badge while viewing Files', () => {
        const store = configureStore({ reducer: { filebrowser: () => ({ hasNewFiles: true }) } });
        const filesIcon = getNavigation().find((item) => item.segment === 'files').icon;
        const away = render(<Provider store={store}><MemoryRouter initialEntries={['/tracking']}>{filesIcon}</MemoryRouter></Provider>);
        expect(away.container.querySelectorAll('svg')).toHaveLength(2);
        away.unmount();

        const onFiles = render(<Provider store={store}><MemoryRouter initialEntries={['/files']}>{filesIcon}</MemoryRouter></Provider>);
        expect(onFiles.container.querySelectorAll('svg')).toHaveLength(1);
    });
});
