import React from 'react';
import { Box, IconButton, Skeleton, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import EditIcon from '@mui/icons-material/Edit';
import CellTowerIcon from '@mui/icons-material/CellTower';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import PublicIcon from '@mui/icons-material/Public';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { useTranslation } from 'react-i18next';
import TargetIcon from '../celestial/target-icon.jsx';
import EntityStatusBadge from './entity-status-badge.jsx';

const healthPresentation = {
    alive: { color: 'success', icon: CheckCircleOutlineIcon, key: 'alive' },
    dead: { color: 'error', icon: HighlightOffIcon, key: 'dead' },
    're-entered': { color: 'warning', icon: InfoOutlinedIcon, key: 're_entered' },
    future: { color: 'info', icon: AccessTimeIcon, key: 'future' },
};

const EntityInfoHeader = ({
    name = '',
    alias = '',
    targetType = 'satellite',
    identifier = '',
    iconIdentifier = identifier,
    color = '',
    health,
    showHealth = true,
    error = '',
    onEdit,
    editLabel = '',
    editDisabled = false,
    onEditTransmitters,
    disabled = false,
    loading = false,
}) => {
    const { t } = useTranslation('common');
    const typeLabel = t(`entity_header.types.${targetType}`);
    const identifierLabel = identifier || '—';
    const metadata = `${typeLabel} · ${identifierLabel}`;
    const healthMeta = Object.hasOwn(healthPresentation, health) ? healthPresentation[health] : null;
    const showHealthBadge = showHealth && targetType === 'satellite' && Boolean(healthMeta);
    const hasStatusRow = showHealthBadge || Boolean(error);
    const FallbackIcon = targetType === 'body' ? PublicIcon : (targetType === 'mission' ? RocketLaunchIcon : SatelliteAltIcon);
    const actions = [
        { onClick: onEdit, label: editLabel || t('entity_header.edit_details'), icon: EditIcon, disabled: editDisabled },
        { onClick: onEditTransmitters, label: t('entity_header.edit_transmitters'), icon: CellTowerIcon },
    ].filter((action) => action.onClick);

    return (
        <Box
            aria-busy={loading}
            sx={{
                flexShrink: 0,
                minWidth: 0,
                px: 1.5,
                py: 1.25,
                bgcolor: 'background.paper',
                backgroundImage: (theme) => {
                    // Satellite health controls its tint; celestial targets keep their assigned color.
                    const tint = targetType === 'satellite'
                        ? (healthMeta ? theme.palette[healthMeta.color].main : theme.palette.text.secondary)
                        : (color || theme.palette.primary.main);
                    const isDark = theme.palette.mode === 'dark';
                    return `linear-gradient(135deg, ${alpha(tint, isDark ? 0.26 : 0.18)} 0%, ${alpha(tint, isDark ? 0.08 : 0.05)} 100%)`;
                },
                borderBottom: '1px solid',
                borderColor: 'divider',
            }}
        >
            {/* Let the name shrink so edit actions stay beside it even in narrow islands. */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr) auto', alignItems: 'center', gap: 1 }}>
                <Box sx={{
                    width: 44,
                    height: 44,
                    position: 'relative',
                }}>
                    {loading ? <Skeleton variant="rounded" width={44} height={44} /> : (
                        <TargetIcon
                            key={`${targetType}:${iconIdentifier}`}
                            targetType={targetType}
                            bodyId={iconIdentifier}
                            size={44}
                            alt={name || typeLabel}
                            showMoonPhase={targetType === 'body'}
                            fallback={<FallbackIcon sx={{ width: 44, height: 44, p: 0.75, color: 'text.secondary' }} />}
                        />
                    )}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                    {loading ? <Skeleton width="90%" height={24} /> : (
                        <Tooltip title={[name, alias].filter(Boolean).join(' · ')}>
                            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                                {name || '—'}
                            </Typography>
                        </Tooltip>
                    )}
                    <Typography variant="caption" title={metadata} sx={{ display: 'block', color: 'text.secondary', overflowWrap: 'anywhere', lineHeight: 1.4 }}>
                        {metadata}
                    </Typography>
                </Box>
                {actions.length > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                        {actions.map(({ onClick, label, icon: Icon, disabled: actionDisabled }) => (
                            <Tooltip key={label} title={label}>
                                <span>
                                    <IconButton size="small" aria-label={label} onClick={onClick} disabled={disabled || loading || actionDisabled} sx={{ width: 32, height: 32 }}>
                                        <Icon fontSize="small" />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        ))}
                    </Box>
                )}
            </Box>
            {hasStatusRow && (loading ? <Skeleton width={160} height={24} sx={{ mt: 1 }} /> : (
                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
                    {showHealthBadge && (
                        <EntityStatusBadge
                            label={t(`satellite_status.${healthMeta.key}`)}
                            color={healthMeta.color}
                            icon={healthMeta.icon}
                        />
                    )}
                    {/* Keep data errors separate from satellite health. */}
                    {error && <EntityStatusBadge label={t('error')} color="error" icon={ErrorOutlineIcon} />}
                </Box>
            ))}
        </Box>
    );
};

export default EntityInfoHeader;
