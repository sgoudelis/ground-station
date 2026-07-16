import React from 'react';
import {
    Accordion,
    AccordionSummary,
    AccordionDetails,
    LoadingOverlay,
} from './settings-elements.jsx';
import Typography from '@mui/material/Typography';
import {
    Box,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
} from "@mui/material";
import { useTranslation } from 'react-i18next';

const FftAccordion = ({
                          expanded,
                          onAccordionChange,
                          gettingSDRParameters,
                          fftSizeValues,
                          localFFTSize,
                          onFFTSizeChange,
                          fftWindowValues,
                          fftWindow,
                          onFFTWindowChange,
                          fftAveraging,
                          onFFTAveragingChange,
                          fftOverlapPercent,
                          onFFTOverlapChange,
                          fftOverlapDepth,
                          onFFTOverlapDepthChange,
                          bandscopeSmoothing,
                          onBandscopeSmoothingChange,
                          colorMaps,
                          localColorMap,
                          onColorMapChange,
                      }) => {
    const { t } = useTranslation('waterfall');
    const selectedColorMap = colorMaps.some((map) => map.id === localColorMap)
        ? localColorMap
        : (colorMaps[0]?.id || '');

    return (
        <Accordion expanded={expanded} onChange={onAccordionChange}>
            <AccordionSummary
                sx={{
                    boxShadow: '-1px 4px 7px #00000059',
                }}
                aria-controls="panel2d-content" id="panel2d-header">
                <Typography component="span">{t('fft.title')}</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{
                backgroundColor: 'background.elevated',
            }}>
                <LoadingOverlay loading={gettingSDRParameters}>
                    <Box sx={{mb: 2}}>
                        <FormControl disabled={gettingSDRParameters}
                                     margin="normal" sx={{minWidth: 200, marginTop: 0, marginBottom: 1}}
                                     fullWidth={true} variant="outlined"
                                     size="small">
                            <InputLabel>{t('fft.fft_size')}</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size="small"
                                value={fftSizeValues.length ? localFFTSize : ""}
                                onChange={(e) => onFFTSizeChange(e.target.value)}
                                label={t('fft.fft_size')} variant={'outlined'}>
                                {fftSizeValues.map(size => (
                                    <MenuItem key={size} value={size}>{size}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl disabled={gettingSDRParameters}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth={true}
                                     variant="outlined" size="small">
                            <InputLabel>{t('fft.fft_window')}</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size="small"
                                value={fftWindowValues.length ? fftWindow : ""}
                                onChange={(e) => onFFTWindowChange(e.target.value)}
                                label={t('fft.fft_window')} variant={'outlined'}>
                                {fftWindowValues.map(window => (
                                    <MenuItem key={window} value={window}>
                                        {window.charAt(0).toUpperCase() + window.slice(1)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl disabled={gettingSDRParameters}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth={true}
                                     variant="outlined" size="small">
                            <InputLabel>{t('fft.fft_averaging')}</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size="small"
                                value={fftAveraging}
                                onChange={(e) => onFFTAveragingChange(e.target.value)}
                                label={t('fft.fft_averaging')} variant={'outlined'}>
                                <MenuItem value={1}>{t('fft.averaging_none')}</MenuItem>
                                <MenuItem value={2}>{t('fft.averaging_samples', { count: 2 })}</MenuItem>
                                <MenuItem value={3}>{t('fft.averaging_samples', { count: 3 })}</MenuItem>
                                <MenuItem value={4}>{t('fft.averaging_samples', { count: 4 })}</MenuItem>
                                <MenuItem value={6}>{t('fft.averaging_samples', { count: 6 })}</MenuItem>
                                <MenuItem value={8}>{t('fft.averaging_samples', { count: 8 })}</MenuItem>
                            </Select>
                        </FormControl>

                        <FormControl disabled={gettingSDRParameters}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth={true}
                                     variant="outlined" size="small">
                            <InputLabel>{t('fft.fft_overlap', { defaultValue: 'FFT Overlap' })}</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size="small"
                                value={fftOverlapPercent}
                                onChange={(e) => onFFTOverlapChange(e.target.value)}
                                label={t('fft.fft_overlap', { defaultValue: 'FFT Overlap' })} variant={'outlined'}>
                                <MenuItem value={0}>{t('fft.overlap_off', { defaultValue: 'Off' })}</MenuItem>
                                <MenuItem value={25}>{t('fft.overlap_25', { defaultValue: 'On (25%)' })}</MenuItem>
                                <MenuItem value={50}>{t('fft.overlap_on_50', { defaultValue: 'On (50%)' })}</MenuItem>
                                <MenuItem value={75}>{t('fft.overlap_75', { defaultValue: 'On (75%)' })}</MenuItem>
                            </Select>
                        </FormControl>

                        <FormControl disabled={gettingSDRParameters || fftOverlapPercent === 0}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth={true}
                                     variant="outlined" size="small">
                            <InputLabel>{t('fft.overlap_depth', { defaultValue: 'Overlap Depth' })}</InputLabel>
                            <Select
                                disabled={gettingSDRParameters || fftOverlapPercent === 0}
                                size="small"
                                value={fftOverlapDepth}
                                onChange={(e) => onFFTOverlapDepthChange(e.target.value)}
                                label={t('fft.overlap_depth', { defaultValue: 'Overlap Depth' })} variant={'outlined'}>
                                <MenuItem value={4}>{t('fft.overlap_depth_segments', { count: 4, defaultValue: '4 segments' })}</MenuItem>
                                <MenuItem value={8}>{t('fft.overlap_depth_segments', { count: 8, defaultValue: '8 segments' })}</MenuItem>
                                <MenuItem value={16}>{t('fft.overlap_depth_segments', { count: 16, defaultValue: '16 segments' })}</MenuItem>
                                <MenuItem value={32}>{t('fft.overlap_depth_segments', { count: 32, defaultValue: '32 segments' })}</MenuItem>
                            </Select>
                        </FormControl>

                        <FormControl disabled={gettingSDRParameters}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth={true}
                                     variant="outlined" size="small">
                            <InputLabel>{t('fft.bandscope_smoothing', { defaultValue: 'Bandscope Smoothing' })}</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size="small"
                                value={bandscopeSmoothing}
                                onChange={(e) => onBandscopeSmoothingChange(e.target.value)}
                                label={t('fft.bandscope_smoothing', { defaultValue: 'Bandscope Smoothing' })}
                                variant={'outlined'}>
                                <MenuItem value={'off'}>{t('fft.smoothing_off', { defaultValue: 'Off' })}</MenuItem>
                                <MenuItem value={'low'}>{t('fft.smoothing_low', { defaultValue: 'Low' })}</MenuItem>
                                <MenuItem value={'medium'}>{t('fft.smoothing_medium', { defaultValue: 'Medium' })}</MenuItem>
                                <MenuItem value={'high'}>{t('fft.smoothing_high', { defaultValue: 'High' })}</MenuItem>
                            </Select>
                        </FormControl>
                        <FormControl disabled={gettingSDRParameters}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth={true}
                                     variant="outlined"
                                     size="small">
                            <InputLabel>{t('fft.color_map')}</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size="small"
                                value={selectedColorMap}
                                onChange={(e) => onColorMapChange(e.target.value)}
                                label={t('fft.color_map')} variant={'outlined'}>
                                {colorMaps.map(map => (
                                    <MenuItem key={map.id} value={map.id}>
                                        {map.name}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>
                </LoadingOverlay>
            </AccordionDetails>
        </Accordion>
    );
};

function areFftAccordionPropsEqual(prevProps, nextProps) {
    return (
        prevProps.expanded === nextProps.expanded &&
        prevProps.onAccordionChange === nextProps.onAccordionChange &&
        prevProps.gettingSDRParameters === nextProps.gettingSDRParameters &&
        prevProps.fftSizeValues === nextProps.fftSizeValues &&
        prevProps.localFFTSize === nextProps.localFFTSize &&
        prevProps.onFFTSizeChange === nextProps.onFFTSizeChange &&
        prevProps.fftWindowValues === nextProps.fftWindowValues &&
        prevProps.fftWindow === nextProps.fftWindow &&
        prevProps.onFFTWindowChange === nextProps.onFFTWindowChange &&
        prevProps.fftAveraging === nextProps.fftAveraging &&
        prevProps.onFFTAveragingChange === nextProps.onFFTAveragingChange &&
        prevProps.fftOverlapPercent === nextProps.fftOverlapPercent &&
        prevProps.onFFTOverlapChange === nextProps.onFFTOverlapChange &&
        prevProps.fftOverlapDepth === nextProps.fftOverlapDepth &&
        prevProps.onFFTOverlapDepthChange === nextProps.onFFTOverlapDepthChange &&
        prevProps.bandscopeSmoothing === nextProps.bandscopeSmoothing &&
        prevProps.onBandscopeSmoothingChange === nextProps.onBandscopeSmoothingChange &&
        prevProps.colorMaps === nextProps.colorMaps &&
        prevProps.localColorMap === nextProps.localColorMap &&
        prevProps.onColorMapChange === nextProps.onColorMapChange
    );
}

export default React.memo(FftAccordion, areFftAccordionPropsEqual);
