/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import React from 'react';
import { Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

export default function FileSearchMatch({ item }) {
    const { t } = useTranslation('filebrowser');
    if (!item.matched_files?.length) return null;
    const label = t('search.matched_inside', {
        defaultValue: 'Matched inside: {{files}}',
        files: item.matched_files.join(', '),
    });

    return (
        <Tooltip title={label}>
            <Typography variant="caption" color="text.secondary" display="block" noWrap sx={{ mt: 0.5 }}>
                {label}
            </Typography>
        </Tooltip>
    );
}
