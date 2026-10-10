/**
 * VFO Dialogs Components
 *
 * Dialog components for transmitters and transcription parameters
 */

import React from 'react';
import {
    Box,
    Dialog,
    DialogTitle,
    DialogContent,
    IconButton,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Alert
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import SharedTransmittersDialog from '../../satellites/transmitters-dialog.jsx';

/**
 * Transmitters Dialog Component
 */
export const TransmittersDialog = ({ open, onClose, targetSatelliteName, targetSatelliteData }) => {
    return (
        <SharedTransmittersDialog
            open={open}
            onClose={onClose}
            title={`${targetSatelliteName || ''} - Transmitters`}
            satelliteData={targetSatelliteData}
            variant="elevated"
        />
    );
};

/**
 * Transcription Parameters Dialog Component
 */
export const TranscriptionParamsDialog = ({
    open,
    onClose,
    vfoIndex,
    vfoMarkers,
    geminiConfigured,
    onVFOPropertyChange,
    getVFODecoderInfo
}) => {
    const { t } = useTranslation('waterfall');

    if (!vfoIndex || !vfoMarkers[vfoIndex]) return null;

    const vfo = vfoMarkers[vfoIndex];
    const decoderInfo = getVFODecoderInfo ? getVFODecoderInfo(vfoIndex) : null;
    const isTranscribing = decoderInfo && decoderInfo.decoder_type === 'transcription';
    const info = decoderInfo?.info || {};
    const isConnected = decoderInfo?.status === 'transcribing';

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: {
                    backgroundColor: 'background.elevated',
                }
            }}
        >
            <DialogTitle sx={{ backgroundColor: 'background.elevated', color: 'text.primary' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6">
                        VFO {vfoIndex} {t('vfo_dialogs.transcription_parameters', { defaultValue: '- Transcription Parameters' })}
                    </Typography>
                    <IconButton onClick={onClose} size="small">
                        <CloseIcon />
                    </IconButton>
                </Box>
            </DialogTitle>
            <DialogContent dividers sx={{ p: 3 }}>
                <Box>
                    {!geminiConfigured && (
                        <Alert severity="warning" sx={{ mb: 2 }}>
                            {t('vfo.configure_gemini', 'Configure Gemini API in Settings to enable transcription')}
                        </Alert>
                    )}

                    {/* Source Language */}
                    <Box sx={{ mb: 2.5 }}>
                        <FormControl fullWidth size="small" variant="outlined">
                            <InputLabel>{t('vfo.source_language', 'Source Language')}</InputLabel>
                            <Select
                                value={vfo.transcriptionLanguage || 'auto'}
                                label={t('vfo.source_language', 'Source Language')}
                                onChange={(e) => onVFOPropertyChange(vfoIndex, { transcriptionLanguage: e.target.value })}
                                disabled={!vfo.transcriptionEnabled || !geminiConfigured}
                                size="small"
                                sx={{ fontSize: '0.875rem' }}
                            >
                                <MenuItem value="auto" sx={{ fontSize: '0.875rem' }}>🌐 {t('vfo.languages.auto', 'Auto-detect')}</MenuItem>
                                <MenuItem value="en" sx={{ fontSize: '0.875rem' }}>🇬🇧 {t('vfo.languages.en', 'English')}</MenuItem>
                                <MenuItem value="el" sx={{ fontSize: '0.875rem' }}>🇬🇷 {t('vfo.languages.el', 'Greek')}</MenuItem>
                                <MenuItem value="es" sx={{ fontSize: '0.875rem' }}>🇪🇸 {t('vfo.languages.es', 'Spanish')}</MenuItem>
                                <MenuItem value="fr" sx={{ fontSize: '0.875rem' }}>🇫🇷 {t('vfo.languages.fr', 'French')}</MenuItem>
                                <MenuItem value="de" sx={{ fontSize: '0.875rem' }}>🇩🇪 {t('vfo.languages.de', 'German')}</MenuItem>
                                <MenuItem value="it" sx={{ fontSize: '0.875rem' }}>🇮🇹 {t('vfo.languages.it', 'Italian')}</MenuItem>
                                <MenuItem value="pt" sx={{ fontSize: '0.875rem' }}>🇵🇹 {t('vfo.languages.pt', 'Portuguese')}</MenuItem>
                                <MenuItem value="pt-BR" sx={{ fontSize: '0.875rem' }}>🇧🇷 {t('vfo.languages.pt-BR', 'Portuguese (Brazil)')}</MenuItem>
                                <MenuItem value="ru" sx={{ fontSize: '0.875rem' }}>🇷🇺 {t('vfo.languages.ru', 'Russian')}</MenuItem>
                                <MenuItem value="uk" sx={{ fontSize: '0.875rem' }}>🇺🇦 {t('vfo.languages.uk', 'Ukrainian')}</MenuItem>
                                <MenuItem value="ja" sx={{ fontSize: '0.875rem' }}>🇯🇵 {t('vfo.languages.ja', 'Japanese')}</MenuItem>
                                <MenuItem value="zh" sx={{ fontSize: '0.875rem' }}>🇨🇳 {t('vfo.languages.zh', 'Chinese')}</MenuItem>
                                <MenuItem value="ar" sx={{ fontSize: '0.875rem' }}>🇸🇦 {t('vfo.languages.ar', 'Arabic')}</MenuItem>
                                <MenuItem value="tl" sx={{ fontSize: '0.875rem' }}>🇵🇭 {t('vfo.languages.tl', 'Filipino')}</MenuItem>
                                <MenuItem value="tr" sx={{ fontSize: '0.875rem' }}>🇹🇷 {t('vfo.languages.tr', 'Turkish')}</MenuItem>
                                <MenuItem value="sk" sx={{ fontSize: '0.875rem' }}>🇸🇰 {t('vfo.languages.sk', 'Slovak')}</MenuItem>
                                <MenuItem value="hr" sx={{ fontSize: '0.875rem' }}>🇭🇷 {t('vfo.languages.hr', 'Croatian')}</MenuItem>
                            </Select>
                        </FormControl>
                    </Box>

                    {/* Translate To */}
                    <Box sx={{ mb: 2.5 }}>
                        <FormControl fullWidth size="small" variant="outlined">
                            <InputLabel>{t('vfo.translate_to', 'Translate To')}</InputLabel>
                            <Select
                                value={vfo.transcriptionTranslateTo || 'none'}
                                label={t('vfo.translate_to', 'Translate To')}
                                onChange={(e) => onVFOPropertyChange(vfoIndex, { transcriptionTranslateTo: e.target.value })}
                                disabled={!vfo.transcriptionEnabled}
                                size="small"
                                sx={{ fontSize: '0.875rem' }}
                            >
                                <MenuItem value="none" sx={{ fontSize: '0.875rem' }}>⭕ {t('vfo.languages.none', 'No Translation')}</MenuItem>
                                <MenuItem value="en" sx={{ fontSize: '0.875rem' }}>🇬🇧 {t('vfo.languages.en', 'English')}</MenuItem>
                                <MenuItem value="el" sx={{ fontSize: '0.875rem' }}>🇬🇷 {t('vfo.languages.el', 'Greek')}</MenuItem>
                                <MenuItem value="es" sx={{ fontSize: '0.875rem' }}>🇪🇸 {t('vfo.languages.es', 'Spanish')}</MenuItem>
                                <MenuItem value="fr" sx={{ fontSize: '0.875rem' }}>🇫🇷 {t('vfo.languages.fr', 'French')}</MenuItem>
                                <MenuItem value="de" sx={{ fontSize: '0.875rem' }}>🇩🇪 {t('vfo.languages.de', 'German')}</MenuItem>
                                <MenuItem value="it" sx={{ fontSize: '0.875rem' }}>🇮🇹 {t('vfo.languages.it', 'Italian')}</MenuItem>
                                <MenuItem value="pt" sx={{ fontSize: '0.875rem' }}>🇵🇹 {t('vfo.languages.pt', 'Portuguese')}</MenuItem>
                                <MenuItem value="pt-BR" sx={{ fontSize: '0.875rem' }}>🇧🇷 {t('vfo.languages.pt-BR', 'Portuguese (Brazil)')}</MenuItem>
                                <MenuItem value="ru" sx={{ fontSize: '0.875rem' }}>🇷🇺 {t('vfo.languages.ru', 'Russian')}</MenuItem>
                                <MenuItem value="uk" sx={{ fontSize: '0.875rem' }}>🇺🇦 {t('vfo.languages.uk', 'Ukrainian')}</MenuItem>
                                <MenuItem value="ja" sx={{ fontSize: '0.875rem' }}>🇯🇵 {t('vfo.languages.ja', 'Japanese')}</MenuItem>
                                <MenuItem value="zh" sx={{ fontSize: '0.875rem' }}>🇨🇳 {t('vfo.languages.zh', 'Chinese')}</MenuItem>
                                <MenuItem value="ar" sx={{ fontSize: '0.875rem' }}>🇸🇦 {t('vfo.languages.ar', 'Arabic')}</MenuItem>
                                <MenuItem value="tl" sx={{ fontSize: '0.875rem' }}>🇵🇭 {t('vfo.languages.tl', 'Filipino')}</MenuItem>
                                <MenuItem value="tr" sx={{ fontSize: '0.875rem' }}>🇹🇷 {t('vfo.languages.tr', 'Turkish')}</MenuItem>
                                <MenuItem value="sk" sx={{ fontSize: '0.875rem' }}>🇸🇰 {t('vfo.languages.sk', 'Slovak')}</MenuItem>
                                <MenuItem value="hr" sx={{ fontSize: '0.875rem' }}>🇭🇷 {t('vfo.languages.hr', 'Croatian')}</MenuItem>
                            </Select>
                        </FormControl>
                    </Box>

                    {/* Deepgram translation info */}
                    {vfo.transcriptionProvider === 'deepgram' &&
                     vfo.transcriptionTranslateTo &&
                     vfo.transcriptionTranslateTo !== 'none' && (
                        <Alert severity="info" sx={{ mb: 2, fontSize: '0.75rem' }}>
                            {t('vfo.deepgram_translation_info', 'Deepgram transcribes audio. Translation uses Google Translate API (configured in Settings).')}
                        </Alert>
                    )}

                    {/* Transcription Stats Display */}
                    {isTranscribing && (
                        <Box sx={{
                            mt: 2,
                            px: 2,
                            py: 1.5,
                            backgroundColor: 'rgba(0, 0, 0, 0.2)',
                            borderRadius: 1,
                            border: '1px solid',
                            borderColor: isConnected ? 'success.dark' : 'error.dark',
                        }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <Box
                                    sx={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: '50%',
                                        backgroundColor: isConnected ? 'success.main' : 'error.main',
                                        boxShadow: (theme) => isConnected
                                            ? `0 0 8px ${theme.palette.success.main}99`
                                            : `0 0 8px ${theme.palette.error.main}99`,
                                    }}
                                />
                                <Typography variant="body2" sx={{
                                    fontFamily: 'monospace',
                                    color: 'text.primary',
                                    fontWeight: 600
                                }}>
                                    {isConnected ? 'Transcribing' : 'Disconnected'}
                                    {info.provider && ` (${info.provider.charAt(0).toUpperCase() + info.provider.slice(1)})`}
                                </Typography>
                            </Box>
                            <Typography variant="body2" sx={{
                                fontFamily: 'monospace',
                                color: 'text.secondary',
                                display: 'block'
                            }}>
                                {t('vfo_dialogs.audio_chunks_sent', { defaultValue: 'Audio chunks sent:' })} {info.transcriptions_sent || 0} {t('vfo_dialogs.captions', { defaultValue: '• Captions:' })} {info.transcriptions_received || 0}
                            </Typography>
                            {info.errors > 0 && (
                                <Typography variant="body2" sx={{
                                    fontFamily: 'monospace',
                                    color: 'error.main',
                                    display: 'block',
                                    mt: 0.5
                                }}>
                                    {t('vfo_dialogs.errors', { defaultValue: 'Errors:' })} {info.errors}
                                </Typography>
                            )}
                        </Box>
                    )}
                </Box>
            </DialogContent>
        </Dialog>
    );
};
