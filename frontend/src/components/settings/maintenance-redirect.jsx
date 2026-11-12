/** Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later */

import { Navigate, useLocation } from 'react-router';
import { MAINTENANCE_ALIASES, MAINTENANCE_PAGES } from '../../config/system-navigation.jsx';

export default function MaintenanceRedirect({ pageKey }) {
    const location = useLocation();
    const params = new URLSearchParams(location.search);
    const requested = pageKey || params.get('mtab');
    const resolved = MAINTENANCE_ALIASES[requested] || requested;
    const page = MAINTENANCE_PAGES.find((item) => item.key === resolved) || MAINTENANCE_PAGES[0];
    // Preserve bookmarks while retiring the query-based tab state. The path is
    // now the single source of truth for sidebar, tabs and browser history.
    params.delete('mtab');
    return <Navigate to={{ pathname: page.path, search: params.toString(), hash: location.hash }} replace />;
}
