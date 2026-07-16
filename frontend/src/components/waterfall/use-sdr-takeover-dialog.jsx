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
    const [open, setOpen] = React.useState(false);
    const [pendingConflict, setPendingConflict] = React.useState(null);
    const [pendingActionLabel, setPendingActionLabel] = React.useState('');
    const resolverRef = React.useRef(null);

    const closeWithResult = React.useCallback((confirmed) => {
        const resolver = resolverRef.current;
        resolverRef.current = null;
        setOpen(false);
        setPendingConflict(null);
        setPendingActionLabel('');
        if (typeof resolver === 'function') {
            resolver(Boolean(confirmed));
        }
    }, []);

    const requestTakeoverConfirmation = React.useCallback((conflict, actionLabel) => {
        return new Promise((resolve) => {
            if (typeof resolverRef.current === 'function') {
                resolverRef.current(false);
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
                resolverRef.current(false);
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
            onClose={() => closeWithResult(false)}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <WarningAmberIcon color="warning" />
                Confirm SDR Takeover
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
                    You are about to {pendingActionLabel || 'continue'} on this SDR. This may disrupt active sessions.
                </Typography>
                {pendingConflict?.includes_internal_observation && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        <AlertTitle>Automated observation active</AlertTitle>
                        Taking over this SDR can interrupt an ongoing scheduled observation.
                    </Alert>
                )}
                {otherSessions.length > 0 && (
                    <Box>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Active sessions on this SDR
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
                                                    <Chip size="small" color="warning" label="Internal" />
                                                )}
                                            </Box>
                                        )}
                                        secondary={(
                                            <Typography variant="caption" color="text.secondary">
                                                Session: {session?.session_id || 'unknown'}
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
                <Button onClick={() => closeWithResult(false)}>
                    Cancel
                </Button>
                <Button onClick={() => closeWithResult(true)} color="warning" variant="contained">
                    Take Over
                </Button>
            </DialogActions>
        </Dialog>
    );

    return {
        requestTakeoverConfirmation,
        takeoverDialog: dialog,
    };
};
