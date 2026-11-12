import React from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import '../../../i18n/config.js';
import { setupTheme } from '../../../theme.js';
import { AdminSystemAboutPage, AdminSystemGeneralPage, AdminSystemFeedbackPage, AdminSystemMaintenancePage } from '../settings.jsx';

vi.mock('../app-settings-form.jsx', () => ({ default: () => <div>General content</div> }));
vi.mock('../feedback-form.jsx', () => ({ default: () => <div>Feedback content</div> }));
vi.mock('../maintenance-form.jsx', () => ({ default: () => <div>Maintenance content</div> }));
vi.mock('../about.jsx', () => ({ default: () => <div>About content</div> }));

describe('System page tabs', () => {
    function renderSystem(path = '/admin/system/general') {
        const router = createMemoryRouter([
            { path: '/admin/system/general', element: <AdminSystemGeneralPage /> },
            { path: '/admin/system/feedback', element: <AdminSystemFeedbackPage /> },
            { path: '/admin/system/maintenance/updates', element: <AdminSystemMaintenancePage /> },
            { path: '/admin/system/about', element: <AdminSystemAboutPage /> },
        ], { initialEntries: [path] });
        render(<ThemeProvider theme={setupTheme('light')}><RouterProvider router={router} /></ThemeProvider>);
        return router;
    }

    it('shows only the requested Settings pages and retains their URLs', async () => {
        const router = renderSystem();
        expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
            'General', 'Hardware', 'Location', 'Users', 'Feedback',
        ]);
        fireEvent.click(screen.getByRole('tab', { name: 'Feedback' }));
        await screen.findByText('Feedback content');
        expect(router.state.location.pathname).toBe('/admin/system/feedback');
        expect(screen.getByRole('tab', { name: 'Feedback' })).toHaveAttribute('aria-selected', 'true');
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
