
import React from 'react';
import {Box,Typography,Paper,IconButton} from '@mui/material';
import { alpha } from '@mui/material/styles';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import InfoIcon from '@mui/icons-material/Info';
import { useTranslation } from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';

const SatelliteTrackSuggestion = ({
                                      selectedSatelliteId,
                                      trackingSatelliteId,
                                      selectedSatellite,
                                      handleSetTrackingOnBackend,
                                      onOpenSatelliteInfo,
                                  }) => {
    const { t } = useTranslation('earthview');

    if (!selectedSatellite) {
        return null;
    }

    const handleOpenSatelliteInfo = () => {
        onOpenSatelliteInfo?.(selectedSatellite);
    };

    return (
        <Paper
            elevation={4}
            sx={{
                position: 'absolute',
                bottom: 10,
                left: 10,
                zIndex: 1000,
                padding: 2,
                maxWidth: 300,
                backgroundColor: (theme) => alpha(
                    theme.palette.background.paper,
                    theme.palette.mode === 'dark' ? 0.86 : 0.94
                ),
                backdropFilter: 'blur(5px)',
                borderRadius: 2,
                transition: 'all 0.3s ease',
                border: '1px solid',
                borderColor: 'border.main',
            }}
        >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="subtitle2" component="div" sx={{ color: 'text.primary', mb: 1 }}>
                    {trackingSatelliteId === selectedSatelliteId ? t('map_target.already_tracking') : t('map_target.start_tracking', { name: selectedSatellite['name'] || 'this satellite' })}
                </Typography>

                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <CapsButton
                        disabled={!selectedSatelliteId || trackingSatelliteId === selectedSatelliteId}
                        variant="contained"
                        color="primary"
                        startIcon={<TrackChangesIcon />}
                        onClick={() => {
                            handleSetTrackingOnBackend(selectedSatelliteId);
                        }}
                        sx={{
                            fontWeight: 'bold',
                            flex: 1,
                            '&:hover': {
                                backgroundColor: 'primary.dark',
                            }
                        }}
                        title={t('map_target.start_tracking_tooltip', { name: selectedSatellite['name'] || 'this satellite' })}
                    >
                        {t('map_target.set_target')}
                    </CapsButton>

                    <IconButton
                        onClick={handleOpenSatelliteInfo}
                        sx={{
                            backgroundColor: 'action.hover',
                            color: 'text.primary',
                            '&:hover': {
                                backgroundColor: 'action.selected',
                            }
                        }}
                        size="small"
                        title={t('map_target.view_details')}
                    >
                        <InfoIcon/>
                    </IconButton>
                </Box>
            </Box>
        </Paper>
    );
};

export default SatelliteTrackSuggestion;
