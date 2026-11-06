import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { useTranslation } from 'react-i18next';

const EntityVisibility = ({ visible = null, supportingText = '', bodyPaddingX = 1.5, bodyPaddingTop = 1.5 }) => {
    const { t } = useTranslation('common');
    const Icon = visible === true ? VisibilityIcon : (visible === false ? VisibilityOffIcon : InfoOutlinedIcon);

    return (
        <Box sx={(theme) => {
            const paletteColor = visible === true ? theme.palette.success : (visible === false ? theme.palette.warning : null);
            const tint = paletteColor?.main || theme.palette.text.secondary;
            return {
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                // Extend through the body's padding to meet all three top edges.
                mx: -bodyPaddingX,
                mt: -bodyPaddingTop,
                mb: 1.25,
                px: bodyPaddingX,
                py: 0.75,
                minHeight: 32,
                color: paletteColor && theme.palette.mode === 'light' ? paletteColor.dark : tint,
                bgcolor: alpha(tint, theme.palette.mode === 'dark' ? 0.16 : 0.1),
                borderBottom: '1px solid',
                borderColor: alpha(tint, 0.25),
            };
        }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flexShrink: 0, maxWidth: '100%' }}>
                <Icon sx={{ fontSize: 16, flexShrink: 0 }} />
                <Typography variant="caption" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {t(visible === true ? 'entity_header.above_horizon' : (visible === false ? 'entity_header.below_horizon' : 'entity_header.visibility_unknown'))}
                </Typography>
            </Box>
            {supportingText && (
                <Tooltip title={supportingText}>
                    <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto', minWidth: 0 }}>
                        <AccessTimeIcon sx={{ fontSize: 14, flexShrink: 0 }} />
                        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {supportingText}
                        </Box>
                    </Typography>
                </Tooltip>
            )}
        </Box>
    );
};

export default EntityVisibility;
