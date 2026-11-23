import React from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import '../../../i18n/config.js';
import { setupTheme } from '../../../theme.js';
import { AdminSystemAboutPage, AdminSystemGeneralPage, AdminSystemMaintenancePage } from '../settings.jsx';

vi.mock('../app-settings-form.jsx', () => ({ default: () => <div>General content</div> }));
vi.mock('../maintenance-form.jsx', () => ({ default: () => <div>Maintenance content</div> }));
vi.mock('../about.jsx', () => ({ default: () => <div>About content</div> }));

describe('System page tabs', () => {
    function renderSystem(path = '/admin/system/general') {
        const router = createMemoryRouter([
            { path: '/admin/system/general', element: <AdminSystemGeneralPage /> },
            { path: '/admin/system/maintenance/updates', element: <AdminSystemMaintenancePage /> },
            { path: '/admin/system/about', element: <AdminSystemAboutPage /> },
        ], { initialEntries: [path] });
        render(<ThemeProvider theme={setupTheme('light')}><RouterProvider router={router} /></ThemeProvider>);
        return router;
    }

    it('shows activity sharing in General without a separate tab', () => {
        const router = renderSystem();
        expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
            'General', 'Hardware', 'Location', 'Users',
        ]);
        expect(screen.getByText('General content')).toBeInTheDocument();
        expect(router.state.location.pathname).toBe('/admin/system/general');
        expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    });

    it.each([
        ['/admin/system/maintenance/updates', 'Maintenance content'],
        ['/admin/system/about', 'About content'],
    ])('keeps %s separate from the Settings tab row', (path, content) => {
        renderSystem(path);
        expect(screen.getByText(content)).toBeInTheDocument();
        expect(screen.queryByRole('tablist', { name: 'Settings' })).not.toBeInTheDocument();
    });
});
