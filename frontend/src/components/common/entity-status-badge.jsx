import React from 'react';
import { Chip } from '@mui/material';

const EntityStatusBadge = ({ label, color = 'default', icon: Icon }) => (
    <Chip
        size="small"
        variant="outlined"
        color={color}
        icon={<Icon />}
        label={label}
        sx={{
            height: 'auto',
            minHeight: 24,
            maxWidth: '100%',
            fontSize: '0.75rem',
            '& .MuiChip-icon': { fontSize: 15 },
            '& .MuiChip-label': { py: 0.25, whiteSpace: 'normal', overflowWrap: 'anywhere' },
        }}
    />
);

export default EntityStatusBadge;
