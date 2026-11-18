/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
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
import {Alert,Box,Chip,Paper,Stack,Typography} from '@mui/material';
import CapsButton from '../../common/capsbutton.jsx';

export const SettingsSurface = ({ children, sx, ...paperProps }) => {
    return (
        <Paper
            elevation={3}
            sx={{
                p: { xs: 1.5, sm: 2 },
                mt: 0,
                borderRadius: 0,
                ...sx,
            }}
            {...paperProps}
        >
            {children}
        </Paper>
    );
};

export const SettingsSurfaceHeader = ({
    title,
    subtitle,
    status,
    onReload,
    reloadLabel,
    reloadDisabled = false,
    actions,
}) => {
    const statusChip = status?.label ? (
        <Chip
            size="small"
            color={status.color || 'default'}
            label={status.label}
            variant={status.variant || 'filled'}
        />
    ) : null;

    const headerActions = actions ?? (onReload ? (
        <CapsButton size="small" onClick={onReload} disabled={reloadDisabled}>
            {reloadLabel}
        </CapsButton>
    ) : null);

    return (
        <Stack spacing={0.75}>
            <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', sm: 'center' }}
                gap={1}
            >
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="h6">{title}</Typography>
                    {statusChip}
                </Stack>
                {headerActions}
            </Stack>
            {subtitle && (
                <Typography variant="body2" color="text.secondary">
                    {subtitle}
                </Typography>
            )}
        </Stack>
    );
};

export const SettingsSection = ({ title, description, meta, children, sx }) => {
    return (
        <Box
            sx={{
                p: { xs: 1.5, sm: 2 },
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                ...sx,
            }}
        >
            <Stack spacing={1.5}>
                {(title || description || meta) && (
                    <Stack spacing={0.5}>
                        {title && (
                            <Typography variant="subtitle1" fontWeight={600}>
                                {title}
                            </Typography>
                        )}
                        {description && (
                            <Typography variant="body2" color="text.secondary">
                                {description}
                            </Typography>
                        )}
                        {meta}
                    </Stack>
                )}
                {children}
            </Stack>
        </Box>
    );
};

export const SettingsMetaRow = ({ children, sx }) => {
    return (
        <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
            sx={sx}
        >
            {children}
        </Stack>
    );
};

export const SettingsBanner = ({ children, sx, ...alertProps }) => {
    return (
        <Alert
            variant="outlined"
            sx={{
                borderRadius: 1,
                alignItems: 'flex-start',
                ...sx,
            }}
            {...alertProps}
        >
            {children}
        </Alert>
    );
};

export const SettingsActionFooter = ({
    statusText,
    children,
    sticky = false,
    mobileInline = false,
    sx,
}) => {
    return (
        <Box
            sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.5,
                bgcolor: 'background.paper',
                ...(sticky ? {
                    position: 'sticky',
                    bottom: 8,
                    zIndex: 2,
                } : null),
                ...sx,
            }}
        >
            <Stack
                direction={mobileInline ? 'row' : { xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={mobileInline ? 'center' : { xs: 'flex-start', sm: 'center' }}
                spacing={mobileInline ? 1 : 1.5}
                flexWrap={mobileInline ? 'wrap' : undefined}
                useFlexGap={mobileInline}
            >
                <Typography
                    variant="body2"
                    role="status"
                    aria-live="polite"
                    sx={mobileInline ? { whiteSpace: 'nowrap' } : undefined}
                >
                    {statusText}
                </Typography>
                <Stack
                    direction="row"
                    spacing={1}
                    flexWrap="wrap"
                    useFlexGap
                    sx={mobileInline ? { ml: 'auto' } : undefined}
                >
                    {children}
                </Stack>
            </Stack>
        </Box>
    );
};
