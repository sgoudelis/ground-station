import React, { useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, FormGroup, Popover, Typography } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import { useTranslation } from 'react-i18next';

const FILE_TYPES = [
    { key: 'showRecordings', label: 'filters.recordings', fallback: 'Recordings' },
    { key: 'showSnapshots', label: 'filters.snapshots', fallback: 'Snapshots' },
    { key: 'showDecoded', label: 'filters.decoded', fallback: 'Decoded' },
    { key: 'showObservations', label: 'filters.observations', fallback: 'Observations' },
    { key: 'showRadiosondes', label: 'filters.weather_balloons', fallback: 'Weather balloons' },
    { key: 'showAircraft', label: 'filters.aircraft', fallback: 'Aircraft' },
    { key: 'showMeshtastic', label: 'filters.meshtastic_nodes', fallback: 'Meshtastic nodes' },
    { key: 'showAudio', label: 'filters.audio', fallback: 'Audio' },
    { key: 'showTranscriptions', label: 'filters.transcriptions', fallback: 'Transcriptions' },
];

export default function FileTypeFilter({ filters, onToggle, onSetAll }) {
    const { t } = useTranslation('filebrowser');
    const [anchorEl, setAnchorEl] = useState(null);
    const open = Boolean(anchorEl);
    const selectedCount = FILE_TYPES.filter(({ key }) => filters[key]).length;
    const filterLabel = t('filter', 'Filter');

    return (
        <>
            <Button
                variant="outlined"
                size="small"
                onClick={(event) => setAnchorEl(event.currentTarget)}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? 'file-type-filter-popover' : undefined}
                sx={{ minWidth: { xs: '100%', sm: 150 }, justifyContent: 'space-between', gap: 1 }}
            >
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                    <FilterListIcon fontSize="small" />
                    {filterLabel}
                </Box>
                <Box
                    component="span"
                    sx={{
                        px: 0.75,
                        py: 0.125,
                        borderRadius: 4,
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        lineHeight: 1.5,
                    }}
                >
                    {selectedCount}/{FILE_TYPES.length}
                </Box>
            </Button>
            <Popover
                id="file-type-filter-popover"
                open={open}
                anchorEl={anchorEl}
                onClose={() => setAnchorEl(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                slotProps={{ paper: { role: 'dialog', 'aria-label': filterLabel, sx: { width: 260, p: 1 } } }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, pb: 0.5 }}>
                    <Typography variant="subtitle2">{filterLabel}</Typography>
                    <Box sx={{ display: 'flex' }}>
                        <Button size="small" disabled={selectedCount === FILE_TYPES.length} onClick={() => onSetAll(true)}>
                            {t('selection.select_all', 'Select All')}
                        </Button>
                        <Button size="small" disabled={selectedCount === 0} onClick={() => onSetAll(false)}>
                            {t('selection.clear', 'Clear')}
                        </Button>
                    </Box>
                </Box>
                <FormGroup>
                    {FILE_TYPES.map(({ key, label, fallback }) => (
                        <FormControlLabel
                            key={key}
                            control={
                                <Checkbox
                                    size="small"
                                    checked={Boolean(filters[key])}
                                    onChange={() => onToggle(key)}
                                />
                            }
                            label={t(label, fallback)}
                            sx={{ m: 0, px: 1, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
                        />
                    ))}
                </FormGroup>
            </Popover>
        </>
    );
}
