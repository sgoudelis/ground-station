import React from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import '../../../i18n/config.js';
import { setupTheme } from '../../../theme.js';
import MaintenanceForm from '../maintenance-form.jsx';
import MaintenanceRedirect from '../maintenance-redirect.jsx';
import { MAINTENANCE_ALIASES } from '../../../config/system-navigation.jsx';

// Test navigation without starting diagnostics, reading live state or invoking
// maintenance actions. Only the currently selected card should mount.
vi.mock('../maintenance/index.jsx', () => Object.fromEntries([
    'BrowserFeaturesCard', 'CanvasDebugCard', 'DatabaseBackupCard', 'EventLogConsoleCard',
    'GridLayoutStorageCard', 'LibraryVersionsCard', 'ReduxPersistentSettingsCard',
    'ReduxStateInspectorCard', 'ServiceControlCard', 'SessionSnapshotCard', 'SocketInfoCard',
    'SystemInfoCard', 'TimeDriftCard', 'TransmitterImportCard', 'UpdateCard',
].map((name) => [name, () => <div>{name}</div>])));

function renderMaintenance(initialEntries) {
    const router = createMemoryRouter([
        { path: '/outside', element: <div>Previous page</div> },
        { path: '/settings/maintenance', element: <MaintenanceRedirect /> },
        { path: '/admin/system/maintenance', element: <MaintenanceRedirect /> },
        ...Object.entries(MAINTENANCE_ALIASES).map(([path, pageKey]) => ({
            path: `/admin/system/maintenance/${path}`,
            element: <MaintenanceRedirect pageKey={pageKey} />,
        })),
        { path: '/admin/system/maintenance/:page', element: <MaintenanceForm /> },
    ], { initialEntries });
    render(<ThemeProvider theme={setupTheme('light')}><RouterProvider router={router} /></ThemeProvider>);
    return router;
}

describe('maintenance page navigation', () => {
    it('opens a deep link and follows page changes and browser history without stale panels', async () => {
        const router = renderMaintenance(['/admin/system/maintenance/sessions']);
        expect(screen.getByText('SessionSnapshotCard')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');

        fireEvent.click(screen.getByRole('tab', { name: 'System', exact: true }));
        await screen.findByText('ServiceControlCard');
        expect(screen.getByText('SystemInfoCard')).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'System Control' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'System Info' })).not.toBeInTheDocument();
        expect(router.state.location.pathname).toBe('/admin/system/maintenance/system');
        expect(screen.queryByText('SessionSnapshotCard')).not.toBeInTheDocument();

        await act(() => router.navigate(-1));
        expect(screen.getByText('SessionSnapshotCard')).toBeInTheDocument();
        await act(() => router.navigate(1));
        expect(screen.getByText('ServiceControlCard')).toBeInTheDocument();

        // A sidebar navigation reuses the same mounted route component.
        await act(() => router.navigate('/admin/system/maintenance/diagnostics'));
        expect(screen.getByRole('tab', { name: 'Diagnostics' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('TimeDriftCard')).toBeInTheDocument();
        expect(screen.queryByText('ServiceControlCard')).not.toBeInTheDocument();
        expect(router.state.location.search).toBe('');

        await act(() => router.navigate('/admin/system/maintenance/frontend-state'));
        expect(screen.getByText('GridLayoutStorageCard')).toBeInTheDocument();
        expect(screen.getByText('ReduxPersistentSettingsCard')).toBeInTheDocument();
        expect(screen.getByText('ReduxStateInspectorCard')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Frontend State' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByRole('tab', { name: 'Redux Inspector' })).not.toBeInTheDocument();
    });

    it.each(['/admin/system/maintenance', '/settings/maintenance'])('redirects legacy %s links without an extra history entry', async (path) => {
        const router = renderMaintenance(['/outside', `${path}?mtab=diagnostics&keep=1#detail`]);
        await screen.findByText('TimeDriftCard');
        expect(router.state.location.pathname).toBe('/admin/system/maintenance/diagnostics');
        expect(router.state.location.search).toBe('?keep=1');
        expect(router.state.location.hash).toBe('#detail');
        await act(() => router.navigate(-1));
        expect(screen.getByText('Previous page')).toBeInTheDocument();
    });

    it.each(['', '?mtab=unknown'])('defaults bare or invalid legacy selections to Updates (%s)', async (search) => {
        const router = renderMaintenance([`/admin/system/maintenance${search}`]);
        await waitFor(() => expect(router.state.location.pathname).toBe('/admin/system/maintenance/updates'));
        expect(screen.getByRole('tab', { name: 'Updates' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('UpdateCard')).toBeInTheDocument();
    });

    it.each([
        '/admin/system/maintenance/redux-inspector',
        '/admin/system/maintenance?mtab=redux-inspector',
        '/settings/maintenance?mtab=redux-inspector',
    ])('redirects the retired inspector link %s to Frontend State', async (path) => {
        const router = renderMaintenance([path]);
        await screen.findByText('ReduxStateInspectorCard');
        expect(router.state.location.pathname).toBe('/admin/system/maintenance/frontend-state');
        expect(screen.getByText('GridLayoutStorageCard')).toBeInTheDocument();
        expect(screen.getByText('ReduxPersistentSettingsCard')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Frontend State' })).toHaveAttribute('aria-selected', 'true');
    });

    it.each(['system-info', 'system-control'].flatMap((key) => [
        `/admin/system/maintenance/${key}`,
        `/admin/system/maintenance?mtab=${key}`,
        `/settings/maintenance?mtab=${key}`,
    ]))('redirects the retired system link %s to the combined System page', async (path) => {
        const router = renderMaintenance([path]);
        await screen.findByText('SystemInfoCard');
        expect(router.state.location.pathname).toBe('/admin/system/maintenance/system');
        expect(screen.getByText('ServiceControlCard')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'System', exact: true })).toHaveAttribute('aria-selected', 'true');
    });
});
