import React from 'react';
import {
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    Grid,
    IconButton,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Paper,
    Tooltip,
    Typography,
} from '@mui/material';
import AudioFileIcon from '@mui/icons-material/AudioFile';
import DescriptionIcon from '@mui/icons-material/Description';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import ImageIcon from '@mui/icons-material/Image';
import RadioIcon from '@mui/icons-material/Radio';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import { useTranslation } from 'react-i18next';

const IMAGE_FILE_TYPES = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];

function formatBytes(bytes) {
    if (!bytes) return '0 Bytes';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
    return `${Math.round((bytes / 1024 ** index) * 100) / 100} ${sizes[index]}`;
}

function formatFrequency(frequencyHz) {
    if (!Number.isFinite(frequencyHz)) return null;
    if (frequencyHz >= 1e9) return `${(frequencyHz / 1e9).toFixed(3)} GHz`;
    if (frequencyHz >= 1e6) return `${(frequencyHz / 1e6).toFixed(3)} MHz`;
    if (frequencyHz >= 1e3) return `${(frequencyHz / 1e3).toFixed(1)} kHz`;
    return `${frequencyHz} Hz`;
}

function formatSampleRate(sampleRateHz) {
    if (!Number.isFinite(sampleRateHz)) return null;
    return sampleRateHz >= 1e6
        ? `${Math.round((sampleRateHz / 1e6) * 100) / 100} Msps`
        : `${Math.round(sampleRateHz / 1e3)} ksps`;
}

function formatObservationTime(timestamp) {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

/** Summary line for a grouped recording card: size, frequency and sample rate. */
function recordingSummary(recording) {
    return [
        formatBytes(recording.data_size),
        formatFrequency(recording.metadata?.center_frequency),
        formatSampleRate(recording.metadata?.sample_rate),
    ]
        .filter(Boolean)
        .join(' · ');
}

function artifactIcon(artifact) {
    if (IMAGE_FILE_TYPES.includes(artifact.file_type)) {
        return <ImageIcon color="success" />;
    }
    if (artifact.kind === 'audio') return <AudioFileIcon color="info" />;
    if (artifact.kind === 'recording') return <RadioIcon color="error" />;
    return <DescriptionIcon color="action" />;
}

function artifactLabel(artifact) {
    if (IMAGE_FILE_TYPES.includes(artifact.file_type)) return 'Image';
    if (artifact.file_type === '.sigmf-data') return 'IQ recording';
    if (artifact.kind === 'audio') return 'Audio recording';
    if (artifact.kind === 'transcription' || artifact.kind === 'transcriptions') return 'Transcript';
    if (artifact.kind === 'decoded') return 'Decoded data';
    return 'Supporting file';
}

export default function ObservationFolderDialog({
    open,
    onClose,
    folder,
    onOpenArtifact,
    onDelete,
}) {
    const { t } = useTranslation('filebrowser');
    if (!folder) return null;

    const artifacts = folder.artifacts || [];
    const recordings = folder.recordings || [];
    const declaredSize = Number(folder.size);
    // Compact observation cards deliberately avoid walking every file and use
    // size: 0. The detail payload already carries every visible artifact size,
    // so use it when that compact value reaches the dialog unchanged.
    const observationSize = Number.isFinite(declaredSize) && declaredSize > 0
        ? declaredSize
        : artifacts.reduce((total, artifact) => {
            const size = Number(artifact.size);
            return total + (Number.isFinite(size) && size > 0 ? size : 0);
        }, 0);
    const metadata = folder.metadata || {};
    const satellite = metadata.satellite && typeof metadata.satellite === 'object'
        ? metadata.satellite
        : {};
    const observationStatus = metadata.status || folder.observation_status;
    const sessionCount = Array.isArray(metadata.sessions) ? metadata.sessions.length : 0;
    const observationDetails = [
        { label: t('observation_folder_dialog.observation_id', { defaultValue: 'Observation ID' }), value: metadata.observation_id, mono: true },
        { label: 'Target', value: satellite.name || folder.satellite_name },
        { label: t('observation_folder_dialog.norad_id', { defaultValue: 'NORAD ID' }), value: satellite.norad_id || folder.satellite_id, mono: true },
        { label: 'Started', value: formatObservationTime(metadata.created_at) },
        { label: 'Finished', value: formatObservationTime(metadata.finalized_at) },
        { label: 'Sessions', value: sessionCount ? `${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}` : null },
    ].filter((detail) => detail.value !== null && detail.value !== undefined && detail.value !== '');
    const scheduledObservation = metadata.scheduled_observation;
    const scheduledDetails = scheduledObservation ? [
        { label: t('observation_folder_dialog.planned_aos', { defaultValue: 'Planned AOS' }), value: formatObservationTime(scheduledObservation.pass?.event_start) },
        { label: t('observation_folder_dialog.planned_los', { defaultValue: 'Planned LOS' }), value: formatObservationTime(scheduledObservation.pass?.event_end) },
        {
            label: t('observation_folder_dialog.peak_elevation', { defaultValue: 'Peak elevation' }),
            value: Number.isFinite(Number(scheduledObservation.pass?.peak_altitude))
                ? `${Number(scheduledObservation.pass.peak_altitude).toFixed(1)}°`
                : null,
        },
        { label: t('observation_folder_dialog.task_start', { defaultValue: 'Task start' }), value: formatObservationTime(scheduledObservation.task_start) },
        { label: t('observation_folder_dialog.task_end', { defaultValue: 'Task end' }), value: formatObservationTime(scheduledObservation.task_end) },
        { label: t('observation_folder_dialog.actual_start', { defaultValue: 'Actual start' }), value: formatObservationTime(scheduledObservation.actual_start_time) },
        { label: t('observation_folder_dialog.actual_end', { defaultValue: 'Actual end' }), value: formatObservationTime(scheduledObservation.actual_end_time) },
    ].filter((detail) => detail.value !== null && detail.value !== undefined && detail.value !== '') : [];
    const statusColor = observationStatus === 'completed'
        ? 'success'
        : observationStatus === 'failed' || observationStatus === 'cancelled'
            ? 'error'
            : observationStatus === 'in_progress' || folder.observation_in_progress
                ? 'warning'
                : 'info';
    // An IQ capture owns several files (SigMF pair, waterfall, thumbnail). The
    // backend tags them with the owning recording so each capture appears once,
    // as a single card, instead of once per file.
    const images = (folder.images || []).filter((image) => !image.recording_name);
    const nonImageArtifacts = artifacts.filter(
        (artifact) => !artifact.recording_name && !IMAGE_FILE_TYPES.includes(artifact.file_type)
    );
    const artifactSections = [
        { id: 'decoded', title: t('observation_folder_dialog.decoded_data', { defaultValue: 'Decoded data' }), artifacts: nonImageArtifacts.filter((artifact) => artifact.kind === 'decoded') },
        { id: 'audio', title: t('observation_folder_dialog.audio_recordings', { defaultValue: 'Audio recordings' }), artifacts: nonImageArtifacts.filter((artifact) => artifact.kind === 'audio') },
        { id: 'transcriptions', title: 'Transcripts', artifacts: nonImageArtifacts.filter((artifact) => artifact.kind === 'transcriptions' || artifact.kind === 'transcription') },
        {
            id: 'other',
            title: t('observation_folder_dialog.other_files', { defaultValue: 'Other files' }),
            artifacts: nonImageArtifacts.filter(
                (artifact) => !['decoded', 'audio', 'transcription', 'transcriptions'].includes(artifact.kind)
            ),
        },
    ].filter((section) => section.artifacts.length > 0);
    const hasArtifacts = recordings.length > 0 || images.length > 0 || artifactSections.length > 0;
    const openArtifact = (artifact) => {
        if (onOpenArtifact) {
            onOpenArtifact(artifact);
            return;
        }
        // Grouped recordings carry download URLs instead of a single file URL.
        const fallbackUrl = artifact.url || artifact.download_urls?.data;
        if (fallbackUrl) window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="lg"
            fullWidth
            PaperProps={{
                sx: {
                    bgcolor: 'background.paper',
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: 2,
                    height: '90vh',
                    maxHeight: '90vh',
                }
            }}
        >
            <DialogTitle sx={{
                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
                borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                py: 2.5,
                px: 3,
            }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                    <Box sx={{ minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <SatelliteAltIcon color="primary" />
                            <Typography variant="h6">{folder.satellite_name || 'Automated Observation'}</Typography>
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                            {folder.foldername}
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexShrink: 0 }}>
                        {folder.observation_in_progress && (
                            <Chip label={t('observation_folder_dialog.in_progress', { defaultValue: 'In progress' })} size="small" color="warning" />
                        )}
                        {recordings.length > 0 && (
                            <Chip
                                label={`${recordings.length} ${recordings.length === 1 ? 'recording' : 'recordings'}`}
                                size="small"
                                color="error"
                                variant="outlined"
                            />
                        )}
                        <Chip label={`${folder.artifact_count || 0} files`} size="small" color="info" />
                        <Chip label={formatBytes(observationSize)} size="small" variant="outlined" />
                    </Box>
                </Box>
            </DialogTitle>
            <DialogContent sx={{
                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.36)' : 'grey.100'),
                overflow: 'auto',
                flex: 1,
                px: 3,
                pt: '32px !important',
                pb: 3,
            }}>
                {(metadata.observation_name || observationStatus || observationDetails.length > 0 || scheduledObservation) && (
                    <Paper
                        variant="outlined"
                        data-testid="observation-details-summary"
                        sx={{
                            mb: 3,
                            overflow: 'hidden',
                            borderRadius: 2,
                            bgcolor: 'background.paper',
                        }}
                    >
                        <Box
                            sx={{
                                px: 2.25,
                                py: 1.5,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 2,
                                borderBottom: observationDetails.length ? '1px solid' : 0,
                                borderColor: 'divider',
                                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50'),
                            }}
                        >
                            <Box sx={{ minWidth: 0 }}>
                                <Typography variant="subtitle2" fontWeight={700}>{t('observation_folder_dialog.observation_details', { defaultValue: 'Observation details' })}</Typography>
                                {metadata.observation_name && (
                                    <Typography variant="body2" color="text.secondary" noWrap>
                                        {metadata.observation_name}
                                    </Typography>
                                )}
                            </Box>
                            {observationStatus && (
                                <Chip
                                    label={observationStatus.replace(/_/g, ' ')}
                                    size="small"
                                    color={statusColor}
                                    sx={{ textTransform: 'capitalize', flexShrink: 0 }}
                                />
                            )}
                        </Box>
                        {observationDetails.length > 0 && (
                            <Box
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
                                    rowGap: 0,
                                    columnGap: 0,
                                }}
                            >
                                {observationDetails.map((detail) => (
                                    <Box
                                        key={detail.label}
                                        sx={{
                                            px: 2.25,
                                            py: 1.25,
                                            minWidth: 0,
                                            borderBottom: { xs: '1px solid', md: 0 },
                                            borderColor: 'divider',
                                            '&:last-child': { borderBottom: 0 },
                                        }}
                                    >
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                            {detail.label}
                                        </Typography>
                                        <Tooltip title={String(detail.value)} placement="top-start">
                                            <Typography variant="body2" noWrap sx={{ fontFamily: detail.mono ? 'monospace' : 'inherit', fontWeight: 600 }}>
                                                {detail.value}
                                            </Typography>
                                        </Tooltip>
                                    </Box>
                                ))}
                            </Box>
                        )}
                        {scheduledObservation && (
                            <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                                <Box
                                    sx={{
                                        px: 2.25,
                                        py: 1.25,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: 2,
                                        bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.03)' : 'grey.50'),
                                    }}
                                >
                                    <Typography variant="subtitle2" fontWeight={700}>{t('observation_folder_dialog.scheduled_pass', { defaultValue: 'Scheduled pass' })}</Typography>
                                </Box>
                                {scheduledDetails.length > 0 && (
                                    <Box
                                        sx={{
                                            display: 'grid',
                                            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
                                        }}
                                    >
                                        {scheduledDetails.map((detail) => (
                                            <Box key={detail.label} sx={{ px: 2.25, py: 1.25, minWidth: 0 }}>
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                    {detail.label}
                                                </Typography>
                                                <Tooltip title={String(detail.value)} placement="top-start">
                                                    <Typography variant="body2" noWrap fontWeight={600}>{detail.value}</Typography>
                                                </Tooltip>
                                            </Box>
                                        ))}
                                    </Box>
                                )}
                                {scheduledObservation.error_message && (
                                    <Box sx={{ mx: 2.25, mb: 1.5, px: 1.25, py: 1, borderRadius: 1, bgcolor: 'error.lighter', color: 'error.dark' }}>
                                        <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, textTransform: 'uppercase' }}>{t('observation_folder_dialog.scheduler_error', { defaultValue: 'Scheduler error' })}{scheduledObservation.error_count ? ` (${scheduledObservation.error_count})` : ''}</Typography>
                                        <Typography variant="body2">{scheduledObservation.error_message}</Typography>
                                    </Box>
                                )}
                            </Box>
                        )}
                    </Paper>
                )}
                <Box sx={{ mt: 1, mb: 2 }}>
                    <Typography variant="subtitle1" fontWeight={700}>
                        {t('observation_folder_dialog.observation_artifacts', { defaultValue: 'Observation artifacts' })}
                        <Box component="span" sx={{ mx: 1, color: 'text.disabled' }}>·</Box>
                        <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.875rem', fontWeight: 400 }}>
                            {t('observation_folder_dialog.select_an_item_to_open_it_in_its_dedicated_viewer', { defaultValue: 'Select an item to open it in its dedicated viewer' })}
                        </Box>
                    </Typography>
                </Box>
                {recordings.length > 0 && (
                    <>
                        <Typography variant="subtitle2" sx={{ mb: 1.25 }}>{t('observation_folder_dialog.iq_recordings', { defaultValue: 'IQ recordings' })}</Typography>
                        <Grid container spacing={1.5} sx={{ mb: 3 }}>
                            {recordings.map((recording) => {
                                const previewUrl = recording.snapshot?.thumbnail_url || recording.snapshot?.url;
                                return (
                                    <Grid item xs={12} sm={6} md={4} key={recording.name}>
                                        <Paper
                                            elevation={0}
                                            onClick={() => openArtifact(recording)}
                                            data-testid="observation-recording-card"
                                            sx={{ cursor: 'pointer', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', transition: 'all 160ms ease', '&:hover': { borderColor: 'primary.main', transform: 'translateY(-2px)', boxShadow: 3 } }}
                                        >
                                            <Box sx={{ position: 'relative', height: 164, bgcolor: 'grey.900', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {previewUrl ? (
                                                    <Box component="img" src={previewUrl} alt={recording.name} loading="lazy" sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
                                                ) : (
                                                    <RadioIcon sx={{ fontSize: 48, color: 'grey.600' }} />
                                                )}
                                                <Chip
                                                    label={recording.recording_in_progress ? 'Recording' : 'IQ recording'}
                                                    size="small"
                                                    color={recording.recording_in_progress ? 'warning' : 'error'}
                                                    sx={{ position: 'absolute', top: 8, left: 8 }}
                                                />
                                            </Box>
                                            <Box sx={{ p: 1.25 }}>
                                                <Tooltip title={recording.name}>
                                                    <Typography variant="body2" noWrap fontWeight={600}>{recording.name}</Typography>
                                                </Tooltip>
                                                <Typography variant="caption" color="text.secondary" noWrap component="div">
                                                    {recordingSummary(recording)}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary" noWrap component="div">
                                                    {t('observation_folder_dialog.open_recording_details', { defaultValue: 'Open recording details' })}
                                                </Typography>
                                            </Box>
                                        </Paper>
                                    </Grid>
                                );
                            })}
                        </Grid>
                        <Divider sx={{ mb: 2 }} />
                    </>
                )}
                {images.length > 0 && (
                    <>
                        <Typography variant="subtitle2" sx={{ mb: 1.25 }}>{t('observation_folder_dialog.image_products', { defaultValue: 'Image products' })}</Typography>
                        <Grid container spacing={1.5} sx={{ mb: 3 }}>
                            {images.map((image) => (
                                <Grid item xs={12} sm={6} md={4} key={image.path}>
                                    <Paper
                                        elevation={0}
                                        onClick={() => openArtifact(image)}
                                        sx={{ cursor: 'pointer', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', transition: 'all 160ms ease', '&:hover': { borderColor: 'primary.main', transform: 'translateY(-2px)', boxShadow: 3 } }}
                                    >
                                        <Box component="img" src={image.thumbnail_url || image.url} alt={image.name} loading="lazy" decoding="async" sx={{ display: 'block', width: '100%', height: 164, objectFit: 'contain', bgcolor: 'grey.900' }} />
                                        <Box sx={{ p: 1.25 }}>
                                            <Typography variant="body2" noWrap fontWeight={600}>{image.name}</Typography>
                                            <Typography variant="caption" color="text.secondary">{formatBytes(image.size)} {t('observation_folder_dialog.open_image_viewer', { defaultValue: '· Open image viewer' })}</Typography>
                                        </Box>
                                    </Paper>
                                </Grid>
                            ))}
                        </Grid>
                        <Divider sx={{ mb: 2 }} />
                    </>
                )}
                {artifactSections.map((section) => (
                    <React.Fragment key={section.id}>
                        <Typography variant="subtitle2" sx={{ mb: 1.25 }}>{section.title}</Typography>
                        <List disablePadding sx={{ display: 'grid', gap: 1, mb: 3 }}>
                            {section.artifacts.map((artifact) => (
                                <Paper
                                    key={artifact.path}
                                    variant="outlined"
                                    sx={{ borderRadius: 2, overflow: 'hidden', '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' } }}
                                >
                                    <ListItemButton onClick={() => openArtifact(artifact)} sx={{ py: 1.1 }}>
                                        <ListItemIcon sx={{ minWidth: 44 }}>{artifactIcon(artifact)}</ListItemIcon>
                                        <ListItemText
                                            primary={artifact.name}
                                            secondary={`${artifactLabel(artifact)} · ${formatBytes(artifact.size)} · ${artifact.path}`}
                                            primaryTypographyProps={{ noWrap: true, fontWeight: 600 }}
                                            secondaryTypographyProps={{ noWrap: true }}
                                        />
                                        <Tooltip title={t('observation_folder_dialog.open_in_dedicated_viewer', { defaultValue: 'Open in dedicated viewer' })}>
                                            <IconButton edge="end" onClick={(event) => { event.stopPropagation(); openArtifact(artifact); }}><DownloadIcon /></IconButton>
                                        </Tooltip>
                                    </ListItemButton>
                                </Paper>
                            ))}
                        </List>
                        <Divider sx={{ mb: 2 }} />
                    </React.Fragment>
                ))}
                {!hasArtifacts && <Typography color="text.secondary">{t('observation_folder_dialog.no_files_were_produced_by_this_observation', { defaultValue: 'No files were produced by this observation.' })}</Typography>}
            </DialogContent>
            <DialogActions disableSpacing sx={{
                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
                borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                px: 3,
                py: 2.5,
                gap: 1,
            }}>
                <Button onClick={onDelete} color="error" variant="outlined" startIcon={<DeleteIcon />} disabled={!onDelete}>
                    {t('observation_folder_dialog.delete', { defaultValue: 'Delete' })}
                </Button>
                <Button onClick={onClose} variant="outlined">{t('observation_folder_dialog.close', { defaultValue: 'Close' })}</Button>
            </DialogActions>
        </Dialog>
    );
}
