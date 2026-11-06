import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { useSocket } from '../common/socket.jsx';
import CelestialEditDialog from './celestialeditdialog.jsx';
import { fetchMonitoredCelestial, updateMonitoredCelestial } from './monitored-slice.jsx';
import { refreshMonitoredCelestialNow } from './celestial-slice.jsx';

export const useCelestialPropertiesDialog = ({ target, onTargetUpdated, onSaved }) => {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { t } = useTranslation('celestial');
    const [propertiesTarget, setPropertiesTarget] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const openDialog = () => {
        if (!socket || !target?.id || saving) return;
        setError('');
        // Snapshot the monitored entry so live updates cannot replace unsaved edits.
        setPropertiesTarget({
            ...target,
            targetType: target.targetType || target.target_type || 'mission',
            displayName: target.displayName || target.display_name || '',
            command: target.command || '',
            bodyId: target.bodyId || target.body_id || '',
            projectionPastHours: Number(target.projectionPastHours ?? target.projection_past_hours ?? 1),
            projectionFutureHours: Number(target.projectionFutureHours ?? target.projection_future_hours ?? 24),
            projectionStepMinutes: Number(target.projectionStepMinutes ?? target.projection_step_minutes ?? 60),
        });
    };

    const saveProperties = async () => {
        if (!socket || !propertiesTarget || saving) return;
        const name = String(propertiesTarget.displayName || '').trim();
        const identifier = propertiesTarget.targetType === 'body'
            ? String(propertiesTarget.bodyId || '').trim()
            : String(propertiesTarget.command || '').trim();
        if (!name || !identifier) {
            setError(t('admin.targets.errors.name_identifier_required'));
            return;
        }
        setSaving(true);
        setError('');
        try {
            const updatedTarget = await dispatch(updateMonitoredCelestial({
                socket,
                entry: propertiesTarget,
            })).unwrap();
            // Let the owning page follow a changed identity before refreshing its scene.
            await onTargetUpdated?.(updatedTarget);
            await dispatch(refreshMonitoredCelestialNow({
                socket,
                ids: [propertiesTarget.id],
            })).unwrap();
            await dispatch(fetchMonitoredCelestial({ socket })).unwrap();
            await onSaved?.(updatedTarget);
            setPropertiesTarget(null);
        } catch (saveError) {
            setError(saveError?.message || saveError?.error || String(saveError || t('errors.unknown_error')));
        } finally {
            setSaving(false);
        }
    };

    return {
        openDialog,
        canEdit: Boolean(socket && target?.id) && !saving,
        label: t('admin.targets.edit.title'),
        dialog: (
            <CelestialEditDialog
                target={propertiesTarget}
                saving={saving}
                error={error}
                onChange={(field, value) => setPropertiesTarget((current) => (
                    current ? { ...current, [field]: value } : current
                ))}
                onClose={() => {
                    if (saving) return;
                    setPropertiesTarget(null);
                    setError('');
                }}
                onSave={saveProperties}
            />
        ),
    };
};
