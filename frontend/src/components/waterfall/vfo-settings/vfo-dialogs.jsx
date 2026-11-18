/**
 * VFO Dialogs Components
 *
 * Dialog components for transmitters and transcription parameters
 */

import React from 'react';
import {Box,Dialog,DialogTitle,DialogContent,DialogActions,IconButton,Typography,FormControl,InputLabel,Select,MenuItem,Alert} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import CapsButton from '../../common/capsbutton.jsx';
import SharedTransmittersDialog from '../../satellites/transmitters-dialog.jsx';
import { useSocket } from '../../common/socket.jsx';
import { getLibreTargetOptions, isLibrePairSupported, resolveTranslationBackend, TranslationBackendField, useLibreTranslateCapabilities } from '../../common/translation-options.jsx';

const TARGET_LANGUAGES = [
    ['en', '🇬🇧', 'English'], ['el', '🇬🇷', 'Greek'], ['es', '🇪🇸', 'Spanish'],
    ['fr', '🇫🇷', 'French'], ['de', '🇩🇪', 'German'], ['it', '🇮🇹', 'Italian'],
    ['pt', '🇵🇹', 'Portuguese'], ['pt-BR', '🇧🇷', 'Portuguese (Brazil)'],
    ['ru', '🇷🇺', 'Russian'], ['uk', '🇺🇦', 'Ukrainian'], ['ja', '🇯🇵', 'Japanese'],
    ['zh', '🇨🇳', 'Chinese'], ['ar', '🇸🇦', 'Arabic'], ['tl', '🇵🇭', 'Filipino'],
    ['tr', '🇹🇷', 'Turkish'], ['sk', '🇸🇰', 'Slovak'], ['hr', '🇭🇷', 'Croatian'],
];

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
    const { socket } = useSocket();
    const vfo = vfoMarkers?.[vfoIndex];
    // Dialogs are mounted on open, so these values remain local until Apply.
    const [draft, setDraft] = React.useState(() => {
        const backend = resolveTranslationBackend(vfo?.transcriptionTranslationBackend, vfo?.transcriptionTranslateTo);
        return {
            transcriptionLanguage: vfo?.transcriptionLanguage || 'auto',
            transcriptionTranslationBackend: backend,
            transcriptionTranslateTo: vfo?.transcriptionProvider !== 'gemini' && backend === 'none'
                ? 'none' : (vfo?.transcriptionTranslateTo || 'none'),
        };
    });
    const [initialDraft] = React.useState(draft);
    const changedFields = Object.keys(draft).filter((field) => draft[field] !== initialDraft[field]);
    const usesSeparateTranslation = ['deepgram', 'parakeet'].includes(vfo?.transcriptionProvider);
    const translationBackend = draft.transcriptionTranslationBackend;
    const isLocal = usesSeparateTranslation && translationBackend === 'libretranslate';
    const capabilities = useLibreTranslateCapabilities(socket, open && usesSeparateTranslation);

    if (!vfoIndex || !vfo) return null;

    const handleApply = () => {
        if (changedFields.length > 0) {
            const updates = Object.fromEntries(changedFields.map((field) => [field, draft[field]]));
            onVFOPropertyChange(vfoIndex, updates);
        }
        onClose();
    };

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
                    <IconButton onClick={onClose} size="small" aria-label={t('common:close', { defaultValue: 'Close' })}>
                        <CloseIcon />
                    </IconButton>
                </Box>
            </DialogTitle>
            <DialogContent dividers sx={{ p: 3 }}>
                <Box>
                    {vfo.transcriptionProvider === 'gemini' && !geminiConfigured && (
                        <Alert severity="warning" sx={{ mb: 2 }}>
                            {t('vfo.configure_gemini', 'Configure Gemini API in Settings to enable transcription')}
                        </Alert>
                    )}

                    {/* Source Language */}
                    <Box sx={{ mb: 2.5 }}>
                        <FormControl fullWidth size="small" variant="outlined">
                            <InputLabel id={`vfo-${vfoIndex}-transcription-language-label`}>
                                {t('vfo.source_language', 'Source Language')}
                            </InputLabel>
                            <Select
                                labelId={`vfo-${vfoIndex}-transcription-language-label`}
                                value={draft.transcriptionLanguage}
                                label={t('vfo.source_language', 'Source Language')}
                                onChange={(e) => setDraft((current) => ({ ...current, transcriptionLanguage: e.target.value }))}
                                disabled={!vfo.transcriptionEnabled}
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
                                {(draft.transcriptionLanguage === 'zh-Hant' || (isLocal && capabilities?.languages?.some((language) => language.code === 'zh-Hant'))) && (
                                    <MenuItem value="zh-Hant" sx={{ fontSize: '0.875rem' }}>🇹🇼 {t('vfo.languages.zh-Hant', 'Chinese (Traditional)')}</MenuItem>
                                )}
                                <MenuItem value="ar" sx={{ fontSize: '0.875rem' }}>🇸🇦 {t('vfo.languages.ar', 'Arabic')}</MenuItem>
                                <MenuItem value="tl" sx={{ fontSize: '0.875rem' }}>🇵🇭 {t('vfo.languages.tl', 'Filipino')}</MenuItem>
                                <MenuItem value="tr" sx={{ fontSize: '0.875rem' }}>🇹🇷 {t('vfo.languages.tr', 'Turkish')}</MenuItem>
                                <MenuItem value="sk" sx={{ fontSize: '0.875rem' }}>🇸🇰 {t('vfo.languages.sk', 'Slovak')}</MenuItem>
                                <MenuItem value="hr" sx={{ fontSize: '0.875rem' }}>🇭🇷 {t('vfo.languages.hr', 'Croatian')}</MenuItem>
                            </Select>
                        </FormControl>
                    </Box>

                    {vfo.transcriptionProvider === 'parakeet' && (
                        <Alert severity="info" sx={{ mb: 2, fontSize: '0.75rem' }}>
                            {t('vfo.parakeet_language_info', 'Parakeet sends audio to the configured service and detects supported languages automatically. The source language selection is used only for translation.')}
                        </Alert>
                    )}

                    {usesSeparateTranslation && (
                        <Box sx={{ mb: 2.5 }}>
                            <TranslationBackendField
                                value={translationBackend}
                                onChange={(value) => setDraft((current) => ({
                                    ...current,
                                    transcriptionTranslationBackend: value,
                                    ...(value === 'none' ? { transcriptionTranslateTo: 'none' } : {}),
                                }))}
                                source={draft.transcriptionLanguage}
                                target={draft.transcriptionTranslateTo}
                                capabilities={capabilities}
                                disabled={!vfo.transcriptionEnabled}
                            />
                        </Box>
                    )}

                    {/* Translate To */}
                    <Box sx={{ mb: 2.5 }}>
                        <FormControl fullWidth size="small" variant="outlined">
                            <InputLabel id={`vfo-${vfoIndex}-transcription-target-label`}>
                                {t('vfo.translate_to', 'Translate To')}
                            </InputLabel>
                            <Select
                                labelId={`vfo-${vfoIndex}-transcription-target-label`}
                                value={draft.transcriptionTranslateTo}
                                label={t('vfo.translate_to', 'Translate To')}
                                onChange={(e) => setDraft((current) => ({ ...current, transcriptionTranslateTo: e.target.value }))}
                                disabled={!vfo.transcriptionEnabled || (usesSeparateTranslation && translationBackend === 'none')}
                                size="small"
                                sx={{ fontSize: '0.875rem' }}
                            >
                                <MenuItem value="none" sx={{ fontSize: '0.875rem' }}>⭕ {t('vfo.languages.none', 'No Translation')}</MenuItem>
                                {getLibreTargetOptions(TARGET_LANGUAGES.map(([value, icon, label]) => ({ value, icon, label })), isLocal ? capabilities : null, draft.transcriptionTranslateTo)
                                    .map((option) => (
                                        <MenuItem key={option.value} value={option.value} sx={{ fontSize: '0.875rem' }}
                                            disabled={isLocal && !isLibrePairSupported(capabilities, draft.transcriptionLanguage, option.value)}>
                                            {option.icon} {t(`vfo.languages.${option.value}`, option.label)}
                                        </MenuItem>
                                    ))}
                            </Select>
                        </FormControl>
                    </Box>

                    {usesSeparateTranslation && translationBackend === 'google' &&
                     draft.transcriptionTranslateTo !== 'none' && (
                        <Alert severity="info" sx={{ mb: 2, fontSize: '0.75rem' }}>
                            {t('vfo.external_translation_info', 'Translation uses Google Translate API (configured in Settings).')}
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
            <DialogActions>
                <CapsButton onClick={onClose}>{t('common:cancel', { defaultValue: 'Cancel' })}</CapsButton>
                <CapsButton variant="contained" onClick={handleApply} disabled={changedFields.length === 0}>
                    {t('common:apply', { defaultValue: 'Apply' })}
                </CapsButton>
            </DialogActions>
        </Dialog>
    );
};
