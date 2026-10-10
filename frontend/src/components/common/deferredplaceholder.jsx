import { Box, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';

// Keeps deferred dashboard cells visually intentional without blocking route input.
const DeferredIslandPlaceholder = () => {
    const { t } = useTranslation('common');

    return (
        <Box
            aria-label={t('deferredplaceholder.loading_panel', { defaultValue: 'Loading panel' })}
            sx={{
                width: '100%',
                height: '100%',
                minHeight: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <CircularProgress size={24} thickness={4} />
        </Box>
    );
};

export default DeferredIslandPlaceholder;
