import * as React from "react";
import { useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router";
import { IconButton, Popover, Box, Typography, Button, Divider } from "@mui/material";
import LocationOffIcon from '@mui/icons-material/LocationOff';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import WarningIcon from '@mui/icons-material/Warning';
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';

function LocationWarningPopover() {
    const { t } = useTranslation('dashboard');
    const navigate = useNavigate();
    const [anchorEl, setAnchorEl] = useState(null);
    const location = useSelector(state => state.location.location);

    const open = Boolean(anchorEl);

    const handleClick = (event) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    const handleGoToSettings = () => {
        handleClose();
        navigate('/admin/system/location');
    };

    // Don't render if location is set
    if (location && location.lat != null && location.lon != null) {
        return null;
    }

    return (
        <>
            <Tooltip title={t('location_warning.tooltip', 'Location not set')}>
                <IconButton
                    onClick={handleClick}
                    sx={{
                        color: 'warning.main',
                        animation: 'pulse 2s infinite',
                        '@keyframes pulse': {
                            '0%, 100%': {
                                opacity: 1,
                            },
                            '50%': {
                                opacity: 0.5,
                            },
                        },
                    }}
                >
                    <LocationOffIcon />
                </IconButton>
            </Tooltip>
            <Popover
                open={open}
                anchorEl={anchorEl}
                onClose={handleClose}
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                }}
                slotProps={{
                    paper: {
                        sx: {
                            mt: 0.5,
                            minWidth: 300,
                            maxWidth: 400,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1.25,
                            overflow: 'hidden',
                        },
                    },
                }}
            >
                <Box sx={{ p: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                        <WarningIcon color="warning" />
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>
                            {t('location_warning.title', 'Location Not Set')}
                        </Typography>
                    </Box>
                    <Divider sx={{ mb: 2 }} />
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {t('location_warning.message', 'Your ground station location has not been configured. Location is required for satellite tracking and pass predictions.')}
                    </Typography>
                    <CapsButton
                        variant="contained"
                        fullWidth
                        startIcon={<LocationOnIcon />}
                        onClick={handleGoToSettings}
                        sx={{ fontWeight: 600 }}
                    >
                        {t('location_warning.set_location', 'Set Location')}
                    </CapsButton>
                </Box>
            </Popover>
        </>
    );
}

export default LocationWarningPopover;
