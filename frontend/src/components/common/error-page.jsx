/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import React from 'react';
import {useNavigate, useRouteError} from 'react-router-dom';
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
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HomeIcon from '@mui/icons-material/Home';
import RefreshIcon from '@mui/icons-material/Refresh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {store} from './store.jsx';
import { useTranslation } from 'react-i18next';

const MAX_ERROR_TEXT_LENGTH = 8000;

const truncate = (value) => {
    const text = String(value ?? '');
    return text.length > MAX_ERROR_TEXT_LENGTH ? `${text.slice(0, MAX_ERROR_TEXT_LENGTH)}…` : text;
};

const normalizeError = (error) => ({
    name: truncate(error?.name || 'Error'),
    message: truncate(error?.message || error?.statusText || (typeof error === 'string' ? error : 'No error message was provided.')),
    stack: truncate(error?.stack || 'No stack trace available.'),
});

const buildErrorReport = (error, status) => {
    const version = store.getState()?.version?.data || {};
    return {
        reportVersion: 1,
        occurredAt: new Date().toISOString(),
        // Avoid copying query strings, which can contain a sensitive shared link.
        route: window.location.pathname,
        build: {
            version: version.version ?? null,
            buildDate: version.buildDate ?? null,
            gitCommit: version.gitCommit ?? null,
        },
        browser: navigator.userAgent,
        error: {
            status,
            statusText: truncate(error?.statusText || ''),
            ...normalizeError(error),
        },
    };
};

const ErrorPage = () => {
    const { t } = useTranslation('common');
    const error = useRouteError();
    const navigate = useNavigate();
    const [showReport, setShowReport] = React.useState(false);
    const [copyState, setCopyState] = React.useState('idle');
    const status = error?.status || 500;
    const title = status === 404 ? 'Page Not Found' : 'Application Error';
    const subtitle = error?.statusText || 'Something went wrong while loading this page.';
    const reportText = React.useMemo(
        () => JSON.stringify(buildErrorReport(error, status), null, 2),
        [error, status],
    );

    const handleCopyReport = React.useCallback(async () => {
        try {
            await navigator.clipboard.writeText(reportText);
            setCopyState('copied');
            window.setTimeout(() => setCopyState('idle'), 1500);
        } catch {
            setCopyState('failed');
            window.setTimeout(() => setCopyState('idle'), 2000);
        }
    }, [reportText]);

    return (
        <Container
            maxWidth="md"
            sx={{
                display: 'flex',
                minHeight: '100vh',
                alignItems: 'center',
                justifyContent: 'center',
                py: 4,
            }}
        >
            <Paper elevation={4} sx={{width: '100%', p: {xs: 2.5, sm: 4}, borderRadius: 2}}>
                <Stack spacing={2.5}>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                        <ErrorOutlineIcon color="error" sx={{fontSize: 30}}/>
                        <Box>
                            <Typography variant="h5" sx={{fontWeight: 700}}>
                                {title}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                {t('error_page.error_code', { defaultValue: 'Error code:' })} {status}
                            </Typography>
                        </Box>
                    </Stack>

                    <Divider/>

                    <Alert severity="error" variant="outlined">
                        {subtitle}
                    </Alert>

                    <Typography variant="body1" color="text.secondary">
                        {t('error_page.please_try_refreshing_the_page_if_the_problem_persists_c', { defaultValue: 'Please try refreshing the page. If the problem persists, copy the error report and include it in a GitHub issue.' })}
                    </Typography>

                    <Stack direction={{xs: 'column', sm: 'row'}} spacing={1.5}>
                        <Button variant="contained" startIcon={<HomeIcon/>} onClick={() => navigate('/')}>
                            {t('error_page.back_to_home', { defaultValue: 'Back to Home' })}
                        </Button>
                        <Button variant="outlined" startIcon={<RefreshIcon/>} onClick={() => window.location.reload()}>
                            {t('error_page.reload_page', { defaultValue: 'Reload Page' })}
                        </Button>
                    </Stack>

                    <Box>
                        <Button
                            variant="text"
                            size="small"
                            onClick={() => setShowReport((visible) => !visible)}
                            sx={{textTransform: 'none', px: 0}}
                        >
                            {showReport ? 'Hide Error Report' : 'Show Error Report'}
                        </Button>
                        {showReport && (
                            <Box
                                sx={{
                                    mt: 1,
                                    borderRadius: 1.5,
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    overflow: 'hidden',
                                    bgcolor: 'background.default',
                                }}
                            >
                                <Box
                                    sx={{
                                        px: 1.5,
                                        py: 1,
                                        borderBottom: '1px solid',
                                        borderColor: 'divider',
                                        bgcolor: 'action.hover',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                    }}
                                >
                                    <Typography variant="caption" sx={{fontWeight: 600}}>
                                        {t('error_page.error_report', { defaultValue: 'Error Report' })}
                                    </Typography>
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        color={copyState === 'failed' ? 'error' : 'primary'}
                                        startIcon={<ContentCopyIcon/>}
                                        onClick={handleCopyReport}
                                        sx={{textTransform: 'none', minWidth: 0, px: 1}}
                                    >
                                        {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy report'}
                                    </Button>
                                </Box>
                                <Box
                                    component="pre"
                                    sx={{
                                        m: 0,
                                        p: 1.5,
                                        overflow: 'auto',
                                        maxHeight: 320,
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                                        fontSize: 12,
                                        lineHeight: 1.45,
                                    }}
                                >
                                    {reportText}
                                </Box>
                            </Box>
                        )}
                    </Box>
                </Stack>
            </Paper>
        </Container>
    );
};

export default ErrorPage;
