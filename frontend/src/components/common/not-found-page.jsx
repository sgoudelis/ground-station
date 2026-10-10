import {
    Alert,
    Box,
    Button,
    Container,
    Divider,
    Paper,
    Stack,
    Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HomeIcon from '@mui/icons-material/Home';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useTranslation } from 'react-i18next';

const NotFoundPage = () => {
    const { t } = useTranslation('common');
    const navigate = useNavigate();

    return (
        <Container
            maxWidth="md"
            sx={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                py: 4,
            }}
        >
            <Paper elevation={4} sx={{ width: '100%', p: { xs: 2.5, sm: 4 }, borderRadius: 2 }}>
                <Stack spacing={2.5}>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                        <ErrorOutlineIcon color="error" sx={{ fontSize: 30 }} />
                        <Box>
                            <Typography variant="h5" sx={{ fontWeight: 700 }}>
                                {t('not_found_page.page_not_found', { defaultValue: 'Page Not Found' })}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                {t('not_found_page.error_code_404', { defaultValue: 'Error code: 404' })}
                            </Typography>
                        </Box>
                    </Stack>

                    <Divider />

                    <Alert severity="error" variant="outlined">
                        {t('not_found_page.the_page_you_requested_does_not_exist_or_may_have_been_m', { defaultValue: 'The page you requested does not exist or may have been moved.' })}
                    </Alert>

                    <Typography variant="body1" color="text.secondary">
                        {t('not_found_page.check_the_url_or_continue_using_one_of_the_actions_below', { defaultValue: 'Check the URL or continue using one of the actions below.' })}
                    </Typography>

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                        <Button
                            variant="contained"
                            startIcon={<HomeIcon />}
                            onClick={() => navigate('/')}
                        >
                            {t('not_found_page.back_to_home', { defaultValue: 'Back to Home' })}
                        </Button>
                        <Button
                            variant="outlined"
                            startIcon={<ArrowBackIcon />}
                            onClick={() => navigate(-1)}
                        >
                            {t('not_found_page.go_back', { defaultValue: 'Go Back' })}
                        </Button>
                    </Stack>
                </Stack>
            </Paper>
        </Container>
    );
};

export default NotFoundPage;
