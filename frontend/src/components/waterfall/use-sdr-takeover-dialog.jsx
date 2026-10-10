import React from 'react';
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    List,
    ListItem,
    ListItemText,
    Typography,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useTranslation } from 'react-i18next';

const normalizeSessions = (sessions) => {
    if (!Array.isArray(sessions)) {
        return [];
    }
    return sessions;
};

const resolveSessionDisplayName = (session) => {
    if (session?.is_internal) {
        return 'Automated observation';
    }
    const username = String(session?.username || '').trim();
    if (username) {
        return username;
    }
    return 'Unknown user';
};

export const useSdrTakeoverDialog = ({ defaultSdrId } = {}) => {
    const { t } = useTranslation('waterfall');
    const [open, setOpen] = React.useState(false);
    const [pendingConflict, setPendingConflict] = React.useState(null);
    const [pendingActionLabel, setPendingActionLabel] = React.useState('');
    const resolverRef = React.useRef(null);

    const closeWithResult = React.useCallback((choice) => {
        const resolver = resolverRef.current;
        resolverRef.current = null;
        setOpen(false);
        setPendingConflict(null);
        setPendingActionLabel('');
        if (typeof resolver === 'function') {
            resolver(choice);
        }
    }, []);

    const requestTakeoverConfirmation = React.useCallback((conflict, actionLabel) => {
        return new Promise((resolve) => {
            if (typeof resolverRef.current === 'function') {
                resolverRef.current('cancel');
            }
            resolverRef.current = resolve;
            setPendingConflict(conflict && typeof conflict === 'object' ? conflict : {});
            setPendingActionLabel(String(actionLabel || '').trim());
            setOpen(true);
        });
    }, []);

    React.useEffect(() => {
        return () => {
            if (typeof resolverRef.current === 'function') {
                resolverRef.current('cancel');
                resolverRef.current = null;
            }
        };
    }, []);

    const otherSessions = React.useMemo(
        () => normalizeSessions(pendingConflict?.other_sessions),
        [pendingConflict]
    );

    const otherSessionCount = Number(pendingConflict?.other_session_count || otherSessions.length || 0);
    const sdrId = pendingConflict?.sdr_id || defaultSdrId || 'selected SDR';
    const message = pendingConflict?.message
        || `SDR '${sdrId}' is currently in use by ${otherSessionCount} other session(s).`;

    const dialog = (
        <Dialog
            open={open}
            onClose={() => closeWithResult('cancel')}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <WarningAmberIcon color="warning" />
                {t('use_sdr_takeover_dialog.sdr_in_use', { defaultValue: 'SDR in use' })}
            </DialogTitle>
            <DialogContent
                sx={{
                    pt: '20px !important',
                    bgcolor: (theme) => (
                        theme.palette.mode === 'dark'
                            ? theme.palette.background.elevated
                            : theme.palette.background.paper
                    ),
                }}
            >
                <Typography variant="body2" sx={{ mb: 1.5 }}>
                    {message}
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                    {t('use_sdr_takeover_dialog.you_are_about_to', { defaultValue: 'You are about to' })} {pendingActionLabel || 'continue'} {t('use_sdr_takeover_dialog.on_this_sdr_joining_lets_you_use_its_current_stream_and_', { defaultValue: 'on this SDR. Joining lets you use its current stream and your own VFOs. The stream stays live while any participant remains. Taking over may disrupt active sessions.' })}
                </Typography>
                {pendingConflict?.includes_internal_observation && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        <AlertTitle>{t('use_sdr_takeover_dialog.automated_observation_active', { defaultValue: 'Automated observation active' })}</AlertTitle>
                        {t('use_sdr_takeover_dialog.taking_over_this_sdr_can_interrupt_an_ongoing_scheduled_', { defaultValue: 'Taking over this SDR can interrupt an ongoing scheduled observation.' })}
                    </Alert>
                )}
                {otherSessions.length > 0 && (
                    <Box>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            {t('use_sdr_takeover_dialog.active_sessions_on_this_sdr', { defaultValue: 'Active sessions on this SDR' })}
                        </Typography>
                        <List dense disablePadding>
                            {otherSessions.map((session, index) => (
                                <ListItem
                                    key={`${session?.session_id || 'session'}-${index}`}
                                    sx={{ px: 0, py: 0.5, alignItems: 'flex-start' }}
                                >
                                    <ListItemText
                                        primary={(
                                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                                    {resolveSessionDisplayName(session)}
                                                </Typography>
                                                {session?.is_internal && (
                                                    <Chip size="small" color="warning" label={t('use_sdr_takeover_dialog.internal', { defaultValue: 'Internal' })} />
                                                )}
                                            </Box>
                                        )}
                                        secondary={(
                                            <Typography variant="caption" color="text.secondary">
                                                {t('use_sdr_takeover_dialog.session', { defaultValue: 'Session:' })} {session?.session_id || 'unknown'}
                                            </Typography>
                                        )}
                                    />
                                </ListItem>
                            ))}
                        </List>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={() => closeWithResult('cancel')}>
                    {t('use_sdr_takeover_dialog.cancel', { defaultValue: 'Cancel' })}
                </Button>
                <Button onClick={() => closeWithResult('join')} variant="outlined">
                    {t('use_sdr_takeover_dialog.join', { defaultValue: 'Join' })}
                </Button>
                <Button onClick={() => closeWithResult('takeover')} color="warning" variant="contained">
                    {t('use_sdr_takeover_dialog.take_over', { defaultValue: 'Take Over' })}
                </Button>
            </DialogActions>
        </Dialog>
    );

    return {
        requestTakeoverConfirmation,
        takeoverDialog: dialog,
    };
};
