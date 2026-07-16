import React from 'react';
import { Box } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

const TargetNumberIcon = React.memo(function TargetNumberIcon({
    targetNumber,
    size = 18,
    variant = 'filled',
    sx = {},
    prefix = 'T',
    iconColor = null,
    badgeBgColor = null,
    badgeTextColor = null,
}) {
    const theme = useTheme();
    const suffix = Number.isFinite(Number(targetNumber)) ? String(targetNumber) : '?';
    const value = `${prefix}${suffix}`;
    const isOutlined = variant === 'outlined';
    const isMuted = variant === 'muted';
    const fontSize = Math.max(11, Math.round(size * 0.68));
    const resolvedIconColor = iconColor || theme.palette.badge?.targetSlot?.outlined || 'info.main';
    const resolvedBadgeBgColor = badgeBgColor || theme.palette.badge?.targetSlot?.background || 'warning.main';
    const resolvedBadgeTextColor = badgeTextColor || theme.palette.badge?.targetSlot?.text || 'common.black';
    const resolvedShadowColor = theme.palette.badge?.targetSlot?.shadow || alpha('#000', 0.2);

    return (
        <Box
            component="span"
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: Math.round(size * 1.05),
                height: size,
                px: 0.45,
                borderRadius: '3px',
                bgcolor: isOutlined ? 'transparent' : resolvedBadgeBgColor,
                color: isOutlined ? resolvedIconColor : resolvedBadgeTextColor,
                opacity: isMuted ? 0.62 : 1,
                boxShadow: isOutlined ? 'none' : `0 1px 3px ${resolvedShadowColor}`,
                lineHeight: 1,
                fontSize: `${fontSize}px`,
                fontWeight: 900,
                letterSpacing: '-0.03em',
                fontFeatureSettings: '"tnum" 1',
                ...sx,
            }}
        >
            {value}
        </Box>
    );
});

export default TargetNumberIcon;
