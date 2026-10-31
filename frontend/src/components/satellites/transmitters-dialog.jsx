/**
 * Shared Transmitters dialog wrapper.
 */

import React, { useState } from 'react';
import { Box, Dialog, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import TransmittersTable from './transmitters-table.jsx';
import { useDelayedUnmount } from '../../hooks/useDelayedUnmount.js';

const TransmittersDialogContent = ({
    open,
    onClose,
    title,
    satelliteData,
    variant = 'elevated',
    maxWidth = 'xl',
    fullWidth = true,
    widthOffsetPx = 0,
}) => {
    const [actionsTarget, setActionsTarget] = useState(null);
    const isPaper = variant === 'paper';
    const elevatedBackground = 'background.elevated';

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth={maxWidth}
            fullWidth={fullWidth}
            PaperProps={{
                sx: {
                    backgroundColor: isPaper ? 'background.paper' : elevatedBackground,
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    ...(maxWidth === 'xl' && widthOffsetPx
                        ? { maxWidth: (theme) => `${theme.breakpoints.values.xl + widthOffsetPx}px` }
                        : null),
                    ...(isPaper ? { borderRadius: 2 } : null),
                },
            }}
        >
            <DialogTitle
                sx={{
                    px: 2,
                    ...(isPaper
                        ? {
                            bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
                            borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                        }
                        : {
                            backgroundColor: elevatedBackground,
                            color: 'text.primary',
                        }),
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Typography variant="h6">{title}</Typography>
                    <Box
                        ref={setActionsTarget}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}
                    />
                    <IconButton onClick={onClose} size="small" sx={{ mr: -0.5 }}>
                        <CloseIcon />
                    </IconButton>
                </Box>
            </DialogTitle>
            <DialogContent
                sx={{
                    p: 0,
                    bgcolor: isPaper ? 'background.paper' : elevatedBackground,
                }}
            >
                {satelliteData && (
                    <TransmittersTable
                        satelliteData={satelliteData}
                        inDialog
                        actionsPortalTarget={actionsTarget}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
};

// Skip the dialog's hooks and subtree entirely while it is closed (after the exit transition);
// closed dialogs otherwise re-render on every parent update.
const TransmittersDialog = (props) => {
    const shouldRender = useDelayedUnmount(props.open);
    return shouldRender ? <TransmittersDialogContent {...props} /> : null;
};

export default TransmittersDialog;
