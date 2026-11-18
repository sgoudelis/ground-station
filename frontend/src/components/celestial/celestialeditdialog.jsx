/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React from 'react';
import {Alert,Dialog,DialogActions,DialogContent,DialogTitle,Stack,TextField,} from '@mui/material';
import { useTranslation } from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';
import TargetProjectionFields from './targetprojectionfields.jsx';

const CelestialEditDialog = ({
    target,
    saving = false,
    error = '',
    onChange,
    onClose,
    onSave,
}) => {
    const { t } = useTranslation('celestial');

    const updateField = (field, value) => {
        onChange?.(field, value);
    };

    return (
        <Dialog
            open={Boolean(target)}
            onClose={saving ? undefined : onClose}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>{t('admin.targets.edit.title')}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ pt: 2 }}>
                    <TextField
                        label={t('admin.targets.edit.display_name')}
                        size="small"
                        value={target?.displayName || ''}
                        disabled={saving}
                        onChange={(event) => updateField('displayName', event.target.value)}
                    />
                    <TextField
                        label={target?.targetType === 'body'
                            ? t('admin.targets.edit.body_id')
                            : t('admin.targets.edit.horizons_command')}
                        size="small"
                        value={target?.targetType === 'body' ? target?.bodyId || '' : target?.command || ''}
                        disabled={saving}
                        onChange={(event) => updateField(
                            target?.targetType === 'body' ? 'bodyId' : 'command',
                            event.target.value,
                        )}
                    />
                    <Stack direction="row" spacing={1} alignItems="center">
                        <TextField
                            label={t('admin.targets.edit.color')}
                            size="small"
                            value={target?.color || ''}
                            disabled={saving}
                            onChange={(event) => updateField('color', event.target.value)}
                            sx={{ flex: 1 }}
                        />
                        <input
                            type="color"
                            aria-label={t('admin.targets.edit.pick_color')}
                            value={/^#[0-9a-f]{6}$/i.test(target?.color || '') ? target.color : '#06D6A0'}
                            disabled={saving}
                            onChange={(event) => updateField('color', event.target.value.toUpperCase())}
                            style={{ width: 44, height: 36 }}
                        />
                    </Stack>
                    <TargetProjectionFields
                        values={target}
                        disabled={saving}
                        idPrefix="edit-target-projection"
                        onChange={updateField}
                    />
                    {error ? <Alert severity="error">{error}</Alert> : null}
                </Stack>
            </DialogContent>
            <DialogActions>
                <CapsButton onClick={onClose} disabled={saving}>{t('admin.common.cancel')}</CapsButton>
                <CapsButton variant="contained" onClick={onSave} disabled={saving}>{t('admin.common.save')}</CapsButton>
            </DialogActions>
        </Dialog>
    );
};

export default CelestialEditDialog;
