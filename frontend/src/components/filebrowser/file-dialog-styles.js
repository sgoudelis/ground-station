import { alpha } from '@mui/material/styles';
import { compactDialogTitleSx, mobileFullScreenPaperSx } from '../common/dialog-layout.js';

// Observation details define the shared appearance of file browser dialogs.
export const fileDialogPaperSx = {
    bgcolor: 'background.paper',
    border: (theme) => `1px solid ${theme.palette.divider}`,
    borderRadius: 2,
    height: '90vh',
    maxHeight: '90vh',
    ...mobileFullScreenPaperSx,
};

export const fileDialogTitleSx = {
    ...compactDialogTitleSx,
    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
};

export const fileDialogContentSx = {
    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.36)' : 'grey.100'),
    overflow: 'auto',
    flex: 1,
    px: 3,
    pt: '24px !important',
    pb: 3,
};

export const fileDialogActionsSx = {
    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
    borderTop: (theme) => `1px solid ${theme.palette.divider}`,
    px: 3,
    py: 2.5,
    gap: 1,
    flexWrap: 'wrap',
};

export const fileDialogSectionSx = {
    mb: 3,
    overflow: 'hidden',
    borderRadius: 2,
    bgcolor: 'background.paper',
};

export const fileDialogSectionHeaderSx = {
    px: 2.25,
    py: 1.5,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
    borderBottom: '1px solid',
    borderColor: 'divider',
    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50'),
};

export const fileDialogDetailsGridSx = {
    display: 'grid',
    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
};

export const fileDialogDetailSx = {
    px: 2.25,
    py: 1.25,
    minWidth: 0,
};

export const fileDialogDetailLabelSx = {
    display: 'block',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
};

// Packet browsers share typography and row spacing; column widths stay protocol-specific.
export const fileDialogPacketTableSx = (theme) => ({
    tableLayout: 'fixed',
    '& th, & td': {px: 1.5, borderColor: 'divider'},
    '& th:first-of-type, & td:first-of-type': {pl: 2.5},
    '& th:last-of-type, & td:last-of-type': {pr: 2.5},
    '& th': {py: 1.25, fontSize: '0.75rem', fontWeight: 600, color: 'text.secondary', verticalAlign: 'top',
        bgcolor: theme.palette.background.elevated || theme.palette.background.default},
    '& td': {py: 1.25, fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums', lineHeight: 1.5},
    '& td.packet-received': {fontSize: '0.76rem'},
    '& td.packet-empty': {py: 5},
    '& tbody tr:nth-of-type(even)': {bgcolor: alpha(theme.palette.text.primary, 0.018)},
    '& tbody tr:hover': {bgcolor: 'action.hover'},
    '& tbody tr:last-of-type td': {borderBottom: 0},
});
