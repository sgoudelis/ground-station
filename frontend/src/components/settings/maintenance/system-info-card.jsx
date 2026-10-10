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
import { useSelector } from 'react-redux';
import {
    Card,
    Typography,
    Box,
    Stack,
    LinearProgress,
    CircularProgress,
    Tooltip,
    useTheme,
} from '@mui/material';
import MemoryIcon from '@mui/icons-material/Memory';
import StorageIcon from '@mui/icons-material/Storage';
import ComputerIcon from '@mui/icons-material/Computer';
import DeviceThermostatIcon from '@mui/icons-material/DeviceThermostat';
import EqualizerIcon from '@mui/icons-material/Equalizer';
import { useTranslation } from 'react-i18next';

const SystemInfoCard = () => {
    const { t } = useTranslation('settings');
    const theme = useTheme();
    const versionInfo = useSelector((state) => state.version?.data);
    const liveSystemInfo = useSelector((state) => state.systemInfo);
    // Prefer live system info from Socket.IO; fall back to version payload (legacy)
    const hasLiveInfo = !!(
        liveSystemInfo && (
            (liveSystemInfo.cpu && (liveSystemInfo.cpu.cores?.logical || liveSystemInfo.cpu.usage_percent !== null)) ||
            (liveSystemInfo.memory && liveSystemInfo.memory.total_gb)
        )
    );
    const systemInfo = hasLiveInfo ? liveSystemInfo : (versionInfo?.system || null);

    if (!systemInfo) {
        return (
            <>
                <Typography variant="h6" gutterBottom>
                    {t('system_info_card.system_information', { defaultValue: 'System Information' })}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    {t('system_info_card.system_information_not_available_yet_ensure_the_ui_is_co', { defaultValue: 'System information not available yet. Ensure the UI is connected to the backend.' })}
                </Typography>
            </>
        );
    }

    return (
        <>
            <Typography variant="h6" gutterBottom>
                {t('system_info_card.system_information', { defaultValue: 'System Information' })}
            </Typography>

            {/* Responsive CSS grid ensures equal-width cards per row */}
            <Box
                sx={{
                    display: 'grid',
                    gap: 2,
                    alignItems: 'stretch',
                    // Auto-fit ensures items share the available row width equally,
                    // and last row items expand to fill remaining space
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                }}
            >
                    {/* CPU Information */}
                    {systemInfo.cpu && (
                        <Box sx={{ display: 'flex' }}>
                            <Card elevation={0} sx={{ p: 2, backgroundColor: 'rgba(33, 150, 243, 0.05)', border: `1px solid ${theme.palette.primary.main}20`, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 220, width: '100%' }}>
                                <Stack spacing={2}>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <MemoryIcon color="primary" fontSize="small" />
                                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                                            {t('system_info_card.cpu', { defaultValue: 'CPU' })}
                                        </Typography>
                                    </Stack>

                                    <Stack spacing={1}>
                                        {(() => {
                                            const proc = systemInfo.cpu.processor;
                                            const arch = systemInfo.cpu.architecture;
                                            const same = proc && arch && proc === arch;
                                            if (proc && arch && !same) {
                                                return (
                                                    <>
                                                        <Box>
                                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                                                {t('system_info_card.processor', { defaultValue: 'Processor' })}
                                                            </Typography>
                                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                                {proc}
                                                            </Typography>
                                                        </Box>
                                                        <Box>
                                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                                                {t('system_info_card.architecture', { defaultValue: 'Architecture' })}
                                                            </Typography>
                                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                                {arch}
                                                            </Typography>
                                                        </Box>
                                                    </>
                                                );
                                            }
                                            // Show only one when equal or when one is missing
                                            const label = proc && !same ? 'Processor' : 'Architecture';
                                            const value = proc && !same ? proc : arch || proc || '';
                                            return value ? (
                                                <Box>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                                        {label}
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                        {value}
                                                    </Typography>
                                                </Box>
                                            ) : null;
                                        })()}

                                        {systemInfo.cpu.cores && (
                                            <Box>
                                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                                    {t('system_info_card.cores', { defaultValue: 'Cores' })}
                                                </Typography>
                                                <Typography variant="body2">
                                                    {systemInfo.cpu.cores.physical} physical, {systemInfo.cpu.cores.logical} logical
                                                </Typography>
                                            </Box>
                                        )}
                                        
                                        {systemInfo.cpu.usage_percent !== null && (
                                            <Box>
                                                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                                        {t('system_info_card.usage', { defaultValue: 'Usage' })}
                                                    </Typography>
                                                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                                        {systemInfo.cpu.usage_percent.toFixed(1)}%
                                                    </Typography>
                                                </Stack>
                                                <LinearProgress 
                                                    variant="determinate" 
                                                    value={systemInfo.cpu.usage_percent} 
                                                    sx={{ 
                                                        height: 6, 
                                                        borderRadius: 1,
                                                        backgroundColor: 'rgba(0,0,0,0.1)',
                                                        '& .MuiLinearProgress-bar': {
                                                            backgroundColor: systemInfo.cpu.usage_percent > 80 ? theme.palette.error.main : 
                                                                           systemInfo.cpu.usage_percent > 60 ? theme.palette.warning.main : 
                                                                           theme.palette.success.main
                                                        }
                                                    }}
                                                />
                                            </Box>
                                        )}

                                    </Stack>
                                </Stack>
                            </Card>
                        </Box>
                    )}

                    {/* Load Average */}
                    {systemInfo.load_avg && (
                        <Box sx={{ display: 'flex' }}>
                            <Card elevation={0} sx={{ p: 2, backgroundColor: 'rgba(33, 150, 243, 0.05)', border: `1px solid ${theme.palette.info.main}20`, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 220, width: '100%' }}>
                                <Stack spacing={2} sx={{ flex: 1 }}>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <EqualizerIcon color="info" fontSize="small" />
                                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                                            {t('system_info_card.load_average', { defaultValue: 'Load Average' })}
                                        </Typography>
                                    </Stack>

                                    {(() => {
                                        const cores = systemInfo?.cpu?.cores?.logical || null;
                                        const loads = [
                                            { key: '1m', label: '1m', value: systemInfo.load_avg['1m'] },
                                            { key: '5m', label: '5m', value: systemInfo.load_avg['5m'] },
                                            { key: '15m', label: '15m', value: systemInfo.load_avg['15m'] },
                                        ];
                                        const toPercent = (load) => {
                                            if (!cores || !Number.isFinite(load) || !Number.isFinite(cores) || cores <= 0) return null;
                                            return Math.max(0, Math.min(100, (load / cores) * 100));
                                        };
                                        const colorFor = (pct) => {
                                            if (pct === null) return theme.palette.text.secondary;
                                            return pct > 100
                                                ? theme.palette.error.main
                                                : pct > 80
                                                    ? theme.palette.warning.main
                                                    : theme.palette.success.main;
                                        };
                                        return (
                                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="stretch" sx={{ flex: 1 }}>
                                                {loads.map((l) => {
                                                    const pct = toPercent(l.value);
                                                    const color = colorFor(pct);
                                                    const title = cores
                                                        ? `${l.label}: ${l.value} (≈ ${pct?.toFixed(0)}% of ${cores} cores)`
                                                        : `${l.label}: ${l.value}`;
                                                    return (
                                                        <Box key={l.key} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                                            <Tooltip title={title} arrow>
                                                                <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                                                                    <CircularProgress
                                                                        variant="determinate"
                                                                        value={pct ?? 0}
                                                                        size={72}
                                                                        thickness={5}
                                                                        sx={{ color }}
                                                                    />
                                                                    <Box
                                                                        sx={{
                                                                            top: 0,
                                                                            left: 0,
                                                                            bottom: 0,
                                                                            right: 0,
                                                                            position: 'absolute',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            justifyContent: 'center',
                                                                            fontFamily: 'monospace',
                                                                        }}
                                                                    >
                                                                        <Typography variant="caption" sx={{ fontWeight: 700 }}>
                                                                            {cores ? `${Math.round(pct ?? 0)}%` : 'N/A'}
                                                                        </Typography>
                                                                    </Box>
                                                                </Box>
                                                            </Tooltip>
                                                            <Typography variant="caption" sx={{ mt: 1, color: 'text.secondary', fontWeight: 600 }}>{l.label}</Typography>
                                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{l.value}</Typography>
                                                        </Box>
                                                    );
                                                })}
                                            </Stack>
                                        );
                                    })()}

                                    {!systemInfo?.cpu?.cores?.logical && (
                                        <Typography variant="caption" color="text.secondary">
                                            {t('system_info_card.per_core_normalization_not_available_logical_core_count_', { defaultValue: 'Per-core normalization not available (logical core count missing)' })}
                                        </Typography>
                                    )}
                                </Stack>
                            </Card>
                        </Box>
                    )}

                    {/* Temperatures (CPU, GPU, Disks) */}
                    <Box sx={{ display: 'flex' }}>
                        <Card elevation={0} sx={{ p: 2, backgroundColor: 'rgba(255, 87, 34, 0.05)', border: `1px solid ${theme.palette.warning.main}20`, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 220, width: '100%' }}>
                            <Stack spacing={2}>
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <DeviceThermostatIcon color="warning" fontSize="small" />
                                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                                        {t('system_info_card.temperatures', { defaultValue: 'Temperatures' })}
                                    </Typography>
                                </Stack>

                                {(() => {
                                    const temps = systemInfo.temperatures || {};
                                    const cpuTemp = typeof temps.cpu_c === 'number' ? temps.cpu_c : (typeof systemInfo.cpu_temp_c === 'number' ? systemInfo.cpu_temp_c : null);
                                    const gpuTemps = Array.isArray(temps.gpus_c) ? temps.gpus_c : [];
                                    const diskTemps = temps.disks_c && typeof temps.disks_c === 'object' ? temps.disks_c : {};

                                    const renderTempBar = (label, value) => {
                                        if (typeof value !== 'number') return null;
                                        const clamped = Math.max(0, Math.min(100, value));
                                        const barColor = clamped > 85 ? theme.palette.error.main : clamped > 70 ? theme.palette.warning.main : theme.palette.success.main;
                                        return (
                                            <Box key={label} sx={{ mb: 1 }}>
                                                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                                        {label}
                                                    </Typography>
                                                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                                        {value}°C
                                                    </Typography>
                                                </Stack>
                                                <LinearProgress
                                                    variant="determinate"
                                                    value={clamped}
                                                    sx={{
                                                        height: 6,
                                                        borderRadius: 1,
                                                        backgroundColor: 'rgba(0,0,0,0.1)',
                                                        '& .MuiLinearProgress-bar': {
                                                            backgroundColor: barColor
                                                        }
                                                    }}
                                                />
                                            </Box>
                                        );
                                    };

                                    const hasAny = cpuTemp !== null || (gpuTemps && gpuTemps.length > 0) || (diskTemps && Object.keys(diskTemps).length > 0);

                                    if (!hasAny) {
                                        return (
                                            <Typography variant="body2" color="text.secondary">
                                                {t('system_info_card.not_available_on_this_platform', { defaultValue: 'Not available on this platform' })}
                                            </Typography>
                                        );
                                    }

                                    return (
                                        <Stack spacing={1}>
                                            {renderTempBar('CPU', cpuTemp)}
                                            {/* GPUs */}
                                            {gpuTemps && gpuTemps.length > 0 && (
                                                <Box>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, display: 'block', mb: 0.5 }}>
                                                        {t('system_info_card.gpus', { defaultValue: 'GPUs' })}
                                                    </Typography>
                                                    <Box>
                                                        {gpuTemps.map((t, idx) => renderTempBar(`GPU ${idx + 1}`, t))}
                                                    </Box>
                                                </Box>
                                            )}
                                            {/* Disks */}
                                            {diskTemps && Object.keys(diskTemps).length > 0 && (
                                                <Box>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, display: 'block', mb: 0.5 }}>
                                                        {t('system_info_card.disks', { defaultValue: 'Disks' })}
                                                    </Typography>
                                                    <Box>
                                                        {Object.entries(diskTemps).map(([name, t]) => renderTempBar(String(name), t))}
                                                    </Box>
                                                </Box>
                                            )}
                                        </Stack>
                                    );
                                })()}
                            </Stack>
                        </Card>
                    </Box>

                    {/* Memory Information */}
                    {systemInfo.memory && (
                        <Box sx={{ display: 'flex' }}>
                            <Card elevation={0} sx={{ p: 2, backgroundColor: 'rgba(156, 39, 176, 0.05)', border: `1px solid ${theme.palette.secondary.main}20`, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 220, width: '100%' }}>
                                <Stack spacing={2}>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <MemoryIcon color="secondary" fontSize="small" />
                                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                                            {t('system_info_card.memory', { defaultValue: 'Memory' })}
                                        </Typography>
                                    </Stack>
                                    
                                    <Stack spacing={1}>
                                        {systemInfo.memory.total_gb && (
                                            <Box>
                                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                                    {t('system_info_card.total', { defaultValue: 'Total' })}
                                                </Typography>
                                                <Typography variant="body2">
                                                    {systemInfo.memory.total_gb.toFixed(2)} GB
                                                </Typography>
                                            </Box>
                                        )}
                                        
                                        {systemInfo.memory.available_gb !== null && (
                                            <Box>
                                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                                    {t('system_info_card.available', { defaultValue: 'Available' })}
                                                </Typography>
                                                <Typography variant="body2">
                                                    {systemInfo.memory.available_gb.toFixed(2)} GB
                                                </Typography>
                                            </Box>
                                        )}
                                        
                                        {systemInfo.memory.usage_percent !== null && (
                                            <Box>
                                                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                                        {t('system_info_card.usage', { defaultValue: 'Usage' })}
                                                    </Typography>
                                                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                                        {systemInfo.memory.usage_percent.toFixed(1)}%
                                                    </Typography>
                                                </Stack>
                                                <LinearProgress 
                                                    variant="determinate" 
                                                    value={systemInfo.memory.usage_percent} 
                                                    sx={{ 
                                                        height: 6, 
                                                        borderRadius: 1,
                                                        backgroundColor: 'rgba(0,0,0,0.1)',
                                                        '& .MuiLinearProgress-bar': {
                                                            backgroundColor: systemInfo.memory.usage_percent > 80 ? theme.palette.error.main : 
                                                                           systemInfo.memory.usage_percent > 60 ? theme.palette.warning.main : 
                                                                           theme.palette.success.main
                                                        }
                                                    }}
                                                />
                                            </Box>
                                        )}
                                    </Stack>
                                </Stack>
                            </Card>
                        </Box>
                    )}

                    {/* Disk Information */}
                    {systemInfo.disk && (
                        <Box sx={{ display: 'flex' }}>
                            <Card elevation={0} sx={{ p: 2, backgroundColor: 'rgba(255, 152, 0, 0.05)', border: `1px solid ${theme.palette.warning.main}20`, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 220, width: '100%' }}>
                                <Stack spacing={2}>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <StorageIcon color="warning" fontSize="small" />
                                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                                            {t('system_info_card.disk', { defaultValue: 'Disk' })}
                                        </Typography>
                                    </Stack>
                                    
                                    <Stack spacing={1}>
                                        {systemInfo.disk.total_gb && (
                                            <Box>
                                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                                    {t('system_info_card.total', { defaultValue: 'Total' })}
                                                </Typography>
                                                <Typography variant="body2">
                                                    {systemInfo.disk.total_gb.toFixed(2)} GB
                                                </Typography>
                                            </Box>
                                        )}
                                        
                                        {systemInfo.disk.available_gb !== null && (
                                            <Box>
                                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                                    {t('system_info_card.available', { defaultValue: 'Available' })}
                                                </Typography>
                                                <Typography variant="body2">
                                                    {systemInfo.disk.available_gb.toFixed(2)} GB
                                                </Typography>
                                            </Box>
                                        )}
                                        
                                        {systemInfo.disk.usage_percent !== null && (
                                            <Box>
                                                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                                        {t('system_info_card.usage', { defaultValue: 'Usage' })}
                                                    </Typography>
                                                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                                        {systemInfo.disk.usage_percent.toFixed(1)}%
                                                    </Typography>
                                                </Stack>
                                                <LinearProgress 
                                                    variant="determinate" 
                                                    value={systemInfo.disk.usage_percent} 
                                                    sx={{ 
                                                        height: 6, 
                                                        borderRadius: 1,
                                                        backgroundColor: 'rgba(0,0,0,0.1)',
                                                        '& .MuiLinearProgress-bar': {
                                                            backgroundColor: systemInfo.disk.usage_percent > 80 ? theme.palette.error.main : 
                                                                           systemInfo.disk.usage_percent > 60 ? theme.palette.warning.main : 
                                                                           theme.palette.success.main
                                                        }
                                                    }}
                                                />
                                            </Box>
                                        )}
                                    </Stack>
                                </Stack>
                            </Card>
                        </Box>
                    )}

                    {/* Operating System Information */}
                    {systemInfo.os && (
                        <Box sx={{ display: 'flex' }}>
                            <Card elevation={0} sx={{ p: 2, backgroundColor: 'rgba(76, 175, 80, 0.05)', border: `1px solid ${theme.palette.success.main}20`, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 220, width: '100%' }}>
                                <Stack spacing={2}>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <ComputerIcon color="success" fontSize="small" />
                                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                                            {t('system_info_card.operating_system', { defaultValue: 'Operating System' })}
                                        </Typography>
                                    </Stack>
                                    
                                    <Stack spacing={1}>
                                        {systemInfo.os.system && (
                                            <Box>
                                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                                    {t('system_info_card.system', { defaultValue: 'System' })}
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                    {systemInfo.os.system}
                                                </Typography>
                                            </Box>
                                        )}
                                        
                                        {systemInfo.os.release && (
                                            <Box>
                                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                                    {t('system_info_card.release', { defaultValue: 'Release' })}
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                    {systemInfo.os.release}
                                                </Typography>
                                            </Box>
                                        )}
                                        
                                        {systemInfo.os.version && (
                                            <Box>
                                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                                                    {t('system_info_card.version', { defaultValue: 'Version' })}
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}>
                                                    {systemInfo.os.version}
                                                </Typography>
                                            </Box>
                                        )}
                                    </Stack>
                                </Stack>
                            </Card>
                        </Box>
                    )}
            </Box>
        </>
    );
};

export default SystemInfoCard;
