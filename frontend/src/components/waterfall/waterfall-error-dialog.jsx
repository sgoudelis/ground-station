import React from 'react';
import {Alert,Box,Dialog,DialogActions,DialogContent,DialogTitle,Typography} from '@mui/material';
import ErrorIcon from '@mui/icons-material/Error';
import { useTranslation } from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';

const WaterfallErrorDialog = ({ open, message, onClose }) => {
    const { t } = useTranslation('waterfall');
    const errorText = typeof message === 'string'
        ? message.trim()
        : String(message?.message || message || '').trim();

    // Command replies prefix the worker's message with the failed operation.
    // Keep the native text intact beneath that summary, including line breaks.
    const parts = errorText.match(/^((?:Failed to [^:\n]+|SDR error)):\s+([\s\S]+)$/);
    const summary = parts ? parts[1] : errorText;
    const details = parts ? parts[2] : null;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            aria-labelledby="error-dialog-title"
            aria-describedby="error-dialog-description"
            fullWidth
            maxWidth="sm"
        >
            <DialogTitle id="error-dialog-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700 }}>
                <ErrorIcon color="error" />
                {t('error_dialog.title')}
            </DialogTitle>
            <DialogContent dividers sx={{ pt: '20px !important', pb: 2.5 }}>
                <Alert
                    id="error-dialog-description"
                    severity="error"
                    variant="outlined"
                    icon={false}
                    sx={{ '& .MuiAlert-message': { width: '100%' } }}
                >
                    <Typography
                        variant="body1"
                        sx={{ fontWeight: 500, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6 }}
                    >
                        {summary}
                    </Typography>
                </Alert>
                {details && (
                    <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                        <Typography variant="caption" sx={{ display: 'block', mb: 0.75, color: 'text.secondary', fontWeight: 600 }}>
                            {t('error_dialog.technical_details')}
                        </Typography>
                        <Box
                            component="pre"
                            sx={{
                                m: 0,
                                p: 1.5,
                                borderRadius: 1,
                                bgcolor: 'action.hover',
                                color: 'text.secondary',
                                fontFamily: 'monospace',
                                fontSize: '0.8125rem',
                                lineHeight: 1.5,
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'anywhere',
                                maxHeight: 240,
                                overflowY: 'auto',
                            }}
                        >
                            {details}
                        </Box>
                    </Box>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 1.5 }}>
                <CapsButton onClick={onClose} variant="contained" color="error" autoFocus>
                    {t('error_dialog.close')}
                </CapsButton>
            </DialogActions>
        </Dialog>
    );
};

export default WaterfallErrorDialog;
