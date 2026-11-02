/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useId, useState} from 'react';
import {Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel,
    InputLabel, MenuItem, Paper, Select, Stack, Switch, Typography} from '@mui/material';
import {useTranslation} from 'react-i18next';
import {defaultMapSettings} from './storage.js';
import {typeLabel} from './transmitters.js';

export default function PacketMapSettingsDialog({settings, hiddenTypes = [], transmitterTypes = [], onApply, onClose, container}) {
    const {t} = useTranslation('earthview');
    const {t: navigationT} = useTranslation('navigation');
    // The dialog mounts on opening, so closing discards unapplied changes.
    const [draft, setDraft] = useState(settings);
    const [draftHiddenTypes, setDraftHiddenTypes] = useState(hiddenTypes);
    const titleId = useId();
    const layerId = useId();
    const dirty = Object.keys(defaultMapSettings).some((key) => draft[key] !== settings[key])
        || transmitterTypes.some((kind) => draftHiddenTypes.includes(kind) !== hiddenTypes.includes(kind));
    const toggle = (key, label) => <FormControlLabel sx={{ml: 0.2}} label={label}
        control={<Switch size="small" checked={draft[key]}
            onChange={(event) => setDraft({...draft, [key]: event.target.checked})} />} />;

    return <Dialog open onClose={onClose} container={container} fullWidth maxWidth="sm" aria-labelledby={titleId}
        slotProps={{paper: {sx: {bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2}}}}>
        <DialogTitle id={titleId} sx={{bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
            borderBottom: 1, borderColor: 'divider', fontSize: '1.125rem', fontWeight: 'bold', py: 2.2}}>
            {t('map_settings.title', {defaultValue: 'Map Settings'})}
        </DialogTitle>
        <DialogContent sx={{p: 2}}>
            <Stack spacing={2} sx={{pt: 2}}>
                <Paper variant="outlined" sx={{p: 1.5, borderRadius: 1.5}}>
                    <Typography variant="subtitle2" sx={{fontWeight: 700, mb: 1.5}}>
                        {t('map_settings.section_base_map', {defaultValue: 'Base Map'})}
                    </Typography>
                    <FormControl size="small" fullWidth>
                        <InputLabel id={layerId}>{navigationT('packet_map.layer', {defaultValue: 'Map layer'})}</InputLabel>
                        <Select labelId={layerId} label={navigationT('packet_map.layer', {defaultValue: 'Map layer'})}
                            value={draft.tileLayerId} onChange={(event) => setDraft({...draft, tileLayerId: event.target.value})}
                            MenuProps={{container}}>
                            <MenuItem value="osm">OpenStreetMap</MenuItem>
                            <MenuItem value="satellite">Satellite</MenuItem>
                            <MenuItem value="hybrid">Satellite + streets</MenuItem>
                            <MenuItem value="topo">Topographic</MenuItem>
                            <MenuItem value="cartodark">Dark (CARTO, API key required)</MenuItem>
                            <MenuItem value="esridarkcanvas">Dark (Esri)</MenuItem>
                            <MenuItem value="stadiadark">Dark streets (Stadia, API key required)</MenuItem>
                        </Select>
                    </FormControl>
                </Paper>
                <Paper variant="outlined" sx={{p: 1.5, borderRadius: 1.5}}>
                    <Typography variant="subtitle2" sx={{fontWeight: 700, mb: 1}}>
                        {navigationT('packet_map.types', {defaultValue: 'Transmitter types'})}
                    </Typography>
                    <Stack>
                        {transmitterTypes.map((kind) => <FormControlLabel key={kind} sx={{ml: 0.2}} label={typeLabel(kind)}
                            control={<Switch size="small" checked={!draftHiddenTypes.includes(kind)}
                                onChange={(event) => setDraftHiddenTypes(event.target.checked
                                    ? draftHiddenTypes.filter((value) => value !== kind) : [...draftHiddenTypes, kind])} />} />)}
                    </Stack>
                </Paper>
                <Paper variant="outlined" sx={{p: 1.5, borderRadius: 1.5}}>
                    <Typography variant="subtitle2" sx={{fontWeight: 700, mb: 1}}>
                        {navigationT('packet_map.view_options', {defaultValue: 'View options'})}
                    </Typography>
                    <Stack>
                        {toggle('enableMapDragging', t('map_controls.enable_panning', {defaultValue: 'Enable map panning'}))}
                        {toggle('enableMapZooming', t('map_controls.enable_gesture_zoom', {defaultValue: 'Enable gesture zoom'}))}
                        {toggle('showTracks', navigationT('packet_map.show_tracks', {defaultValue: 'Show transmitter tracks'}))}
                    </Stack>
                </Paper>
            </Stack>
        </DialogContent>
        <DialogActions sx={{p: 2, borderTop: 1, borderColor: 'divider', gap: 1, overflowX: 'auto',
            '& > *': {flexShrink: 0, whiteSpace: 'nowrap'}}}>
            <Button variant="outlined" onClick={() => {setDraft({...defaultMapSettings}); setDraftHiddenTypes([]);}}>
                {t('map_settings.reset_defaults', {defaultValue: 'Reset Defaults'})}
            </Button>
            <Box sx={{flex: 1}} />
            <Button variant="outlined" onClick={onClose}>{t('close', {defaultValue: 'Close'})}</Button>
            <Button variant="contained" disabled={!dirty} onClick={() => onApply(draft, draftHiddenTypes)}>
                {t('map_settings.apply', {defaultValue: 'Apply'})}
            </Button>
        </DialogActions>
    </Dialog>;
}
