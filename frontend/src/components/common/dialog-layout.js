// Give detail dialogs the full viewport on mobile, matching satellite details.
export const mobileFullScreenPaperSx = {
    '@media (max-width:599.95px)': {
        width: '100%',
        maxWidth: '100%',
        height: '100dvh',
        minHeight: '100dvh',
        maxHeight: '100dvh',
        m: 0,
        borderRadius: 0,
    },
};

export const compactDialogTitleSx = {
    minHeight: 48,
    py: 2.5,
    px: {xs: 1.5, sm: 2.5},
};
