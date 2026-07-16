import React from 'react';
import { Box, Divider, Menu, MenuItem, Typography } from '@mui/material';

export default function RowContextMenu({
    open,
    onClose,
    onSuppressNativeContextMenu,
    anchorPosition,
    title,
    noradId,
    items = [],
}) {
    return (
        <Menu
            open={Boolean(open)}
            onClose={onClose}
            onContextMenu={onSuppressNativeContextMenu}
            anchorReference="anchorPosition"
            transitionDuration={0}
            PaperProps={{
                onContextMenu: onSuppressNativeContextMenu,
                sx: {
                    minWidth: 210,
                },
            }}
            MenuListProps={{
                dense: true,
                onContextMenu: onSuppressNativeContextMenu,
                sx: {
                    py: 0,
                    px: 0,
                },
            }}
            anchorPosition={anchorPosition}
        >
            <MenuItem
                dense
                disabled
                disableRipple
                sx={{
                    m: 0,
                    p: 0,
                    minHeight: 0,
                    opacity: 1,
                    borderRadius: 0,
                    backgroundColor: 'action.hover',
                    '&.Mui-disabled': { opacity: 1 },
                }}
            >
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 1,
                        width: '100%',
                        minWidth: 0,
                        height: 32,
                        px: 1,
                    }}
                >
                    <Typography
                        variant="body2"
                        sx={{
                            fontSize: '0.82rem',
                            fontWeight: 800,
                            lineHeight: 1.2,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}
                    >
                        {title || `NORAD ${noradId ?? '-'}`}
                    </Typography>
                    <Box
                        component="span"
                        sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            px: 0.7,
                            py: 0.1,
                            borderRadius: 999,
                            border: '1px solid',
                            borderColor: 'divider',
                            color: 'text.secondary',
                            fontSize: '0.66rem',
                            lineHeight: 1.2,
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                        }}
                    >
                        NORAD {noradId ?? '-'}
                    </Box>
                </Box>
            </MenuItem>
            {items.map((item, index) => {
                if (item?.type === 'divider') {
                    return <Divider key={item.key || `divider-${index}`} sx={{ my: 0 }} />;
                }
                return (
                    <MenuItem
                        key={item?.key || `item-${index}`}
                        sx={{ px: 1.2, py: 0.45, minHeight: 30, fontSize: '0.82rem', borderRadius: 0 }}
                        disabled={Boolean(item?.disabled)}
                        onClick={item?.onClick}
                    >
                        {item?.label}
                    </MenuItem>
                );
            })}
        </Menu>
    );
}
