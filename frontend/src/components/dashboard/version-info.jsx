
import React, { useEffect } from 'react';
import { useDispatch, useSelector, shallowEqual } from 'react-redux';
import { Typography, Box, Chip, Tooltip } from '@mui/material';
import { fetchVersionInfo } from './version-slice';
import { useTranslation } from 'react-i18next';

const VersionInfo = ({ minimal = false }) => {
    const dispatch = useDispatch();
    const { t } = useTranslation('dashboard');
    const { data, loading, error } = useSelector((state) => state.version);
    // Select only static systemInfo fields to avoid re-renders on live metrics updates
    const staticSystemInfo = useSelector(
        (state) => ({
            cpuArch: state.systemInfo?.cpu?.architecture,
            coresLogical: state.systemInfo?.cpu?.cores?.logical,
            coresPhysical: state.systemInfo?.cpu?.cores?.physical,
            memTotal: state.systemInfo?.memory?.total_gb,
            diskTotal: state.systemInfo?.disk?.total_gb,
            osSystem: state.systemInfo?.os?.system,
            osRelease: state.systemInfo?.os?.release,
            osVersion: state.systemInfo?.os?.version,
        }),
        shallowEqual
    );
    const hasFetchedRef = React.useRef(false);

    // Determine environment
    const environment = import.meta.env.MODE || 'unknown';
    const envColor = environment === 'production' ? 'error' : 'success';

    useEffect(() => {
        // Fetch version info only once when component mounts
        if (!hasFetchedRef.current) {
            hasFetchedRef.current = true;
            dispatch(fetchVersionInfo());
        }
    }, [dispatch]);

    if (minimal) {
        // Extract CPU architecture (e.g., x86_64 -> x64, aarch64 -> arm64)
        const cpuArch = staticSystemInfo.cpuArch;
        let archLabel = 'unknown';
        if (cpuArch) {
            if (cpuArch.includes('x86_64') || cpuArch.includes('amd64')) {
                archLabel = 'x64';
            } else if (cpuArch.includes('aarch64') || cpuArch.includes('arm64')) {
                archLabel = 'arm64';
            } else if (cpuArch.includes('armv7')) {
                archLabel = 'armv7';
            } else {
                archLabel = cpuArch.substring(0, 6); // Truncate long arch names
            }
        }

        // Determine environment label
        const envLabel = environment === 'production' ? 'PROD' : 'DEV';

        // Build tooltip content with system info (static values only)
        const tooltipContent = (
            <Box sx={{ fontSize: '0.75rem', lineHeight: 1.4 }}>
                <Box><strong>{t('version_info.version', { defaultValue: 'Version:' })}</strong> {data?.version || t('version_info.unknown')}</Box>
                <Box><strong>{t('version_info.build_date', { defaultValue: 'Build Date:' })}</strong> {data?.buildDate || t('version_info.unknown')}</Box>
                <Box><strong>{t('version_info.git_commit', { defaultValue: 'Git Commit:' })}</strong> {data?.gitCommit || t('version_info.unknown')}</Box>
                <Box sx={{ mt: 0.5 }}><strong>{t('version_info.architecture', { defaultValue: 'Architecture:' })}</strong> {cpuArch || 'unknown'}</Box>
                <Box><strong>{t('version_info.cpu_cores', { defaultValue: 'CPU Cores:' })}</strong> {staticSystemInfo.coresLogical || '?'} ({staticSystemInfo.coresPhysical || '?'} physical)</Box>
                <Box><strong>{t('version_info.memory_total', { defaultValue: 'Memory (total):' })}</strong> {staticSystemInfo.memTotal ?? '?'}{staticSystemInfo.memTotal != null ? ' GB' : ''}</Box>
                <Box><strong>{t('version_info.disk_total', { defaultValue: 'Disk (total):' })}</strong> {staticSystemInfo.diskTotal ?? '?'}{staticSystemInfo.diskTotal != null ? ' GB' : ''}</Box>
                <Box><strong>{t('version_info.os', { defaultValue: 'OS:' })}</strong> {(staticSystemInfo.osSystem || 'unknown')} {(staticSystemInfo.osRelease || '')}</Box>
            </Box>
        );

        return (
            <Tooltip title={tooltipContent} placement="bottom-start">
                <Typography
                    variant="caption"
                    sx={{
                        fontSize: '0.65rem',
                        fontFamily: 'monospace',
                        color: (theme) => theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)',
                        cursor: 'default',
                        userSelect: 'none',
                    }}
                >
                    {data?.version?.split('-')[0] || 'v?.?.?'} • {archLabel} • {envLabel}
                </Typography>
            </Tooltip>
        );
    }

    if (loading) {
        return <Typography variant="caption">{t('version_info.loading')}</Typography>;
    }

    if (error) {
        return <Typography variant="caption" color="error">{t('version_info.unavailable')}</Typography>;
    }

    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="body2">
                    <strong>{t('version_info.version')}</strong> {data?.version || t('version_info.unknown')}
                </Typography>
                <Chip
                    label={environment === 'production' ? 'PRODUCTION' : 'DEVELOPMENT'}
                    size="small"
                    color={envColor}
                />
            </Box>
            <Typography variant="caption" display="block">
                <strong>{t('version_info.build_date')}</strong> {data?.buildDate || t('version_info.unknown')}
            </Typography>
            <Typography variant="caption" display="block">
                <strong>{t('version_info.git_commit')}</strong> {data?.gitCommit || t('version_info.unknown')}
            </Typography>
        </Box>
    );
};

export default React.memo(VersionInfo);