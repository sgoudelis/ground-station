import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
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
