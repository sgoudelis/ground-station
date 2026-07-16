import React from 'react';
import { Box } from '@mui/material';
import { WaterfallStatusBarPaper } from '../common/common.jsx';

const CelestialStatusBar = ({ gestureHintText = '', scaleLabel = '' }) => {
    return (
        <WaterfallStatusBarPaper>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                    fontSize: '0.75rem',
                    fontFamily: 'monospace',
                    color: 'text.secondary',
                    width: '100%',
                }}
            >
                <Box
                    component="span"
                    sx={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {gestureHintText}
                </Box>
                <Box
                    component="span"
                    sx={{
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                    }}
                >
                    {scaleLabel}
                </Box>
            </Box>
        </WaterfallStatusBarPaper>
    );
};

export default React.memo(CelestialStatusBar);
