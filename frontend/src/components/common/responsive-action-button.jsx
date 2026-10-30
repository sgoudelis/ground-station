/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import React from 'react';
import { Button, Tooltip } from '@mui/material';

export default function ResponsiveActionButton({ label, compactQuery, sx = [], ...props }) {
    const button = (
        <Button
            {...props}
            aria-label={label}
            sx={[
                {
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    // Query the surrounding panel so narrow desktop layouts also use icons.
                    [compactQuery]: {
                        minWidth: 40,
                        minHeight: 40,
                        p: 1,
                        '& .MuiButton-startIcon': { m: 0 },
                        '& .responsive-action-label': { display: 'none' },
                    },
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            <span className="responsive-action-label">{label}</span>
        </Button>
    );

    return (
        <Tooltip title={label}>
            {/* Keep the wrapper stable when busy; disabled buttons need it for tooltips. */}
            <span style={{ display: 'inline-flex', flexShrink: 0 }}>{button}</span>
        </Tooltip>
    );
}
