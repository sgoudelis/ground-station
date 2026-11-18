import React from 'react';
import {Dialog,DialogActions,DialogContent,DialogContentText,DialogTitle,Typography,} from '@mui/material';
import ErrorIcon from '@mui/icons-material/Error';
import {useTranslation} from 'react-i18next';
import CapsButton from './capsbutton.jsx';

export default function ErrorDialog({open, message, onClose, title}) {
    const {t} = useTranslation('common');
    const dialogId = React.useId();
    const titleId = `${dialogId}-title`;
    const descriptionId = `${dialogId}-description`;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            fullWidth
            maxWidth="sm"
        >
            <DialogTitle id={titleId} sx={{display: 'flex', alignItems: 'center', gap: 1}}>
                <ErrorIcon color="error" />
                <Typography component="span" variant="h6" sx={{fontWeight: 'bold'}}>
                    {title || t('error')}
                </Typography>
            </DialogTitle>
            <DialogContent sx={{'&.MuiDialogContent-root': {pt: 2}}}>
                <DialogContentText id={descriptionId} sx={{whiteSpace: 'pre-wrap', wordBreak: 'break-word'}}>
                    {message}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <CapsButton onClick={onClose} variant="contained" color="error" autoFocus>
                    {t('close')}
                </CapsButton>
            </DialogActions>
        </Dialog>
    );
}
