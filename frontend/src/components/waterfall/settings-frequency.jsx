import React from 'react';
import {
    Accordion,
    AccordionSummary,
    AccordionDetails,
} from './settings-elements.jsx';
import Typography from '@mui/material/Typography';
import {
    Box,
    Button,
    FormControl,
    InputLabel,
    Menu,
    MenuItem,
    Select,
    TextField,
    ListSubheader,
} from "@mui/material";
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import NearMeIcon from '@mui/icons-material/NearMe';

import { getFrequencyBand } from "../common/common.jsx";
import FrequencyDisplay from "./frequency-dial.jsx";
import TransmitterTargetLabel from './transmitter-target-label.jsx';
import { useTranslation } from 'react-i18next';

const FrequencyControlAccordion = ({
                                       expanded,
                                       onAccordionChange,
                                       centerFrequency,
                                       onCenterFrequencyChange,
                                       availableTransmitters,
                                       onGoToTransmitter,
                                       selectedOffsetMode,
                                       onOffsetModeChange,
                                       selectedOffsetValue,
                                       onOffsetValueChange,
                                       isRecording,
                                       selectedSDRId,
                                       isStreaming,
                                       readOnly = false,
}) => {
    const { t } = useTranslation('waterfall');
    const [menuAnchor, setMenuAnchor] = React.useState(null);
    const [offsetMenuOpen, setOffsetMenuOpen] = React.useState(false);
    // Recording, playback, and continuous viewers cannot retune the receiver.
    const isPlayingback = selectedSDRId === 'sigmf-playback' && isStreaming;
    const controlsDisabled = readOnly || isRecording || isPlayingback;
    const menuOpen = Boolean(menuAnchor) && !controlsDisabled;

    React.useEffect(() => {
        // Menus live in portals and must also close when a session becomes read only.
        if (controlsDisabled) {
            setMenuAnchor(null);
            setOffsetMenuOpen(false);
        }
    }, [controlsDisabled]);

    const handleMenuItemClick = (transmitter) => {
        if (controlsDisabled) return;
        // Different targets can publish the same transmitter ID; use the exact menu choice.
        onGoToTransmitter(transmitter);
        setMenuAnchor(null);
    };

    // Group transmitters by band
    const groupedTransmitters = React.useMemo(() => {
        const groups = {};
        availableTransmitters.forEach(tx => {
            const band = getFrequencyBand(tx.downlink_low);
            if (!groups[band]) {
                groups[band] = [];
            }
            groups[band].push(tx);
        });

        // Sort bands by frequency (using first transmitter in each band)
        const bandOrder = ['VHF', 'UHF', 'L-band', 'S-band', 'C-band', 'X-band', 'Ku-band', 'K-band', 'Ka-band'];
        const sortedBands = Object.keys(groups).sort((a, b) => {
            const aIndex = bandOrder.indexOf(a);
            const bIndex = bandOrder.indexOf(b);
            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return a.localeCompare(b);
        });

        return sortedBands.map(band => ({ band, transmitters: groups[band] }));
    }, [availableTransmitters]);

    return (
        <Accordion expanded={expanded} onChange={onAccordionChange}>
            <AccordionSummary
                sx={{
                    boxShadow: '-1px 4px 7px #00000059',
                }}
                aria-controls="freq-content" id="freq-header">
                <Typography component="span">{t('frequency.title')}</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{
                backgroundColor: 'background.elevated',
            }}>
                <Box sx={{mb: 0, width: '100%'}}>
                    <FrequencyDisplay
                        initialFrequency={centerFrequency / 1000.0}
                        onChange={onCenterFrequencyChange}
                        size={"small"}
                        hideHzDigits={true}
                        disabled={controlsDisabled}
                    />
                </Box>

                <Box sx={{ mt: 1.5 }}>
                    <Button
                        id="go-to-transmitter-button"
                        variant="contained"
                        fullWidth
                        disabled={controlsDisabled || availableTransmitters.length === 0}
                        startIcon={<NearMeIcon />}
                        endIcon={<ArrowDropDownIcon />}
                        onClick={(event) => setMenuAnchor(event.currentTarget)}
                        aria-haspopup="menu"
                        aria-controls={menuOpen ? 'go-to-transmitter-menu' : undefined}
                        aria-expanded={menuOpen ? 'true' : undefined}
                        sx={{ py: 1, fontWeight: 700, letterSpacing: 0.5, justifyContent: 'space-between' }}
                    >
                        {t('frequency.go_to_transmitter')}
                    </Button>
                    <Menu
                        id="go-to-transmitter-menu"
                        anchorEl={menuAnchor}
                        open={menuOpen}
                        onClose={() => setMenuAnchor(null)}
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                        MenuListProps={{ 'aria-labelledby': 'go-to-transmitter-button' }}
                        PaperProps={{ sx: { maxHeight: 400, minWidth: menuAnchor?.clientWidth || 300 } }}
                    >
                        {groupedTransmitters.map(({ band, transmitters: groupTx }) => [
                            <ListSubheader key={`header-${band}`} sx={{ fontSize: '0.75rem', fontWeight: 'bold', lineHeight: '32px' }}>
                                {band}
                            </ListSubheader>,
                            ...groupTx.map((transmitter) => (
                                <MenuItem
                                    key={transmitter.uiId || transmitter.id}
                                    disabled={controlsDisabled}
                                    onClick={() => handleMenuItemClick(transmitter)}
                                    sx={{ fontSize: '0.875rem', pl: 3 }}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                        <Box
                                            sx={{
                                                width: 8,
                                                height: 8,
                                                borderRadius: '50%',
                                                backgroundColor: transmitter.alive ? 'success.main' : 'error.main',
                                                boxShadow: (theme) => transmitter.alive
                                                    ? `0 0 6px ${theme.palette.success.main}99`
                                                    : `0 0 6px ${theme.palette.error.main}99`,
                                                flexShrink: 0,
                                            }}
                                        />
                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                            <Box sx={{ fontWeight: 600 }}>{transmitter.description}</Box>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mt: 0.3, minWidth: 0, whiteSpace: 'nowrap', fontSize: '0.75rem', color: 'text.secondary' }}>
                                                <TransmitterTargetLabel transmitter={transmitter} sx={{ flexShrink: 0, maxWidth: '50%' }} />
                                                <Box component="span" sx={{ flexShrink: 0 }}>•</Box>
                                                <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {[
                                                        `${(transmitter.downlink_low / 1e6).toFixed(6)} MHz (${transmitter.mode})`,
                                                        transmitter.source || 'Unknown',
                                                    ].filter(Boolean).join(' • ')}
                                                </Box>
                                            </Box>
                                        </Box>
                                    </Box>
                                </MenuItem>
                            ))
                        ])}
                    </Menu>
                </Box>

                <FormControl
                    disabled={controlsDisabled}
                    sx={{minWidth: 200, marginTop: 1, marginBottom: 0}}
                    fullWidth
                    variant="outlined"
                    size="small">
                    <InputLabel htmlFor="frequency-offset-select">{t('frequency.frequency_offset')}</InputLabel>
                    <Select
                        id="frequency-offset-select"
                        open={offsetMenuOpen && !controlsDisabled}
                        onOpen={() => setOffsetMenuOpen(true)}
                        onClose={() => setOffsetMenuOpen(false)}
                        value={selectedOffsetMode || "none"}
                        onChange={onOffsetModeChange}
                        label={t('frequency.frequency_offset')}
                        size="small">
                        <MenuItem value="none" sx={{ fontSize: '0.875rem' }}>
                            <Box>
                                <Box sx={{ fontWeight: 600 }}>{t('frequency.no_frequency_offset')}</Box>
                                <Box sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>0 Hz</Box>
                            </Box>
                        </MenuItem>
                        <MenuItem value="manual" sx={{ fontSize: '0.875rem' }}>
                            <Box>
                                <Box sx={{ fontWeight: 600 }}>{t('frequency.manual')}</Box>
                                <Box sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{t('settings_frequency.custom_value', { defaultValue: 'Custom value' })}</Box>
                            </Box>
                        </MenuItem>
                        <MenuItem value="" disabled>
                            <em>{t('frequency.select_offset')}</em>
                        </MenuItem>
                        <MenuItem value="-6800000000" sx={{ fontSize: '0.875rem' }}>
                            <Box>
                                <Box sx={{ fontWeight: 600 }}>{t('frequency.offsets.dk5av_x_band')}</Box>
                                <Box sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>-6.8 GHz</Box>
                            </Box>
                        </MenuItem>
                        <MenuItem value="125000000" sx={{ fontSize: '0.875rem' }}>
                            <Box>
                                <Box sx={{ fontWeight: 600 }}>{t('frequency.offsets.ham_it_up')}</Box>
                                <Box sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>+125 MHz</Box>
                            </Box>
                        </MenuItem>
                        <MenuItem value="-10700000000" sx={{ fontSize: '0.875rem' }}>
                            <Box>
                                <Box sx={{ fontWeight: 600 }}>{t('frequency.offsets.ku_lnb_10700')}</Box>
                                <Box sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>-10.7 GHz</Box>
                            </Box>
                        </MenuItem>
                        <MenuItem value="-9750000000" sx={{ fontSize: '0.875rem' }}>
                            <Box>
                                <Box sx={{ fontWeight: 600 }}>{t('frequency.offsets.ku_lnb_9750')}</Box>
                                <Box sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>-9.75 GHz</Box>
                            </Box>
                        </MenuItem>
                        <MenuItem value="-1998000000" sx={{ fontSize: '0.875rem' }}>
                            <Box>
                                <Box sx={{ fontWeight: 600 }}>{t('frequency.offsets.mmds_s_band')}</Box>
                                <Box sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>-1.998 GHz</Box>
                            </Box>
                        </MenuItem>
                        <MenuItem value="120000000" sx={{ fontSize: '0.875rem' }}>
                            <Box>
                                <Box sx={{ fontWeight: 600 }}>{t('frequency.offsets.spyverter')}</Box>
                                <Box sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>+120 MHz</Box>
                            </Box>
                        </MenuItem>
                    </Select>
                </FormControl>

                <FormControl disabled={selectedOffsetMode !== "manual" || controlsDisabled} sx={{minWidth: 200, marginTop: 1}}
                             fullWidth variant="outlined"
                             size="small">
                    <TextField
                        disabled={selectedOffsetMode !== "manual" || controlsDisabled}
                        label={t('frequency.manual_offset_hz')}
                        value={selectedOffsetValue}
                        variant="outlined"
                        size="small"
                        type="number"
                        onChange={(e) => {
                            const offset = parseFloat(e.target.value);
                            if (!isNaN(offset)) {
                                onOffsetValueChange({target: {value: offset.toString()}});
                            }
                        }}
                    />
                </FormControl>

            </AccordionDetails>
        </Accordion>
    );
};

function areFrequencyControlAccordionPropsEqual(prevProps, nextProps) {
    return (
        prevProps.expanded === nextProps.expanded &&
        prevProps.onAccordionChange === nextProps.onAccordionChange &&
        prevProps.centerFrequency === nextProps.centerFrequency &&
        prevProps.onCenterFrequencyChange === nextProps.onCenterFrequencyChange &&
        prevProps.availableTransmitters === nextProps.availableTransmitters &&
        prevProps.onGoToTransmitter === nextProps.onGoToTransmitter &&
        prevProps.selectedOffsetMode === nextProps.selectedOffsetMode &&
        prevProps.onOffsetModeChange === nextProps.onOffsetModeChange &&
        prevProps.selectedOffsetValue === nextProps.selectedOffsetValue &&
        prevProps.onOffsetValueChange === nextProps.onOffsetValueChange &&
        prevProps.isRecording === nextProps.isRecording &&
        prevProps.selectedSDRId === nextProps.selectedSDRId &&
        prevProps.isStreaming === nextProps.isStreaming &&
        prevProps.readOnly === nextProps.readOnly
    );
}

export default React.memo(FrequencyControlAccordion, areFrequencyControlAccordionPropsEqual);
