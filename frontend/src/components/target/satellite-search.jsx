import * as React from "react";
import {useSocket} from "../common/socket.jsx";
import {Fragment} from "react";
import { toast } from "../../utils/toast-with-timestamp.jsx";
import Autocomplete from "@mui/material/Autocomplete";
import {Box, Chip, CircularProgress, Divider, Paper, TextField, Typography} from "@mui/material";
import { useTranslation } from 'react-i18next';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import PublicIcon from '@mui/icons-material/Public';
import AdjustIcon from '@mui/icons-material/Adjust';

const TARGET_TYPES = Object.freeze({
    SATELLITE: 'satellite',
    MISSION: 'mission',
    BODY: 'body',
});

const TARGET_TYPE_LABEL = Object.freeze({
    [TARGET_TYPES.SATELLITE]: 'Satellite',
    [TARGET_TYPES.MISSION]: 'Mission',
    [TARGET_TYPES.BODY]: 'Body',
});

const TARGET_TYPE_ICON = Object.freeze({
    [TARGET_TYPES.SATELLITE]: SatelliteAltIcon,
    [TARGET_TYPES.MISSION]: RocketLaunchIcon,
    [TARGET_TYPES.BODY]: PublicIcon,
});

const normalizeTargetOption = (rawOption) => {
    if (!rawOption || typeof rawOption !== 'object') {
        return null;
    }
    const targetType = String(rawOption?.target_type || rawOption?.targetType || TARGET_TYPES.SATELLITE)
        .trim()
        .toLowerCase();
    if (targetType === TARGET_TYPES.MISSION) {
        const command = String(rawOption?.command || '').trim();
        if (!command) return null;
        const mission_id_value = String(rawOption?.mission_id || '').trim().toLowerCase();
        const normalizedMissionId = mission_id_value.startsWith('mission:')
            ? mission_id_value.slice('mission:'.length)
            : (mission_id_value.includes(':') ? '' : mission_id_value);
        const displayName = String(rawOption?.target_name || rawOption?.display_name || command).trim();
        const missionTargetKey = `mission:${command}`;
        return {
            ...rawOption,
            id: missionTargetKey,
            target_type: TARGET_TYPES.MISSION,
            target_key: missionTargetKey,
            target_name: displayName,
            target_identifier: String(rawOption?.target_identifier || command).trim(),
            mission_id: normalizedMissionId || null,
            command,
            display_name: String(rawOption?.display_name || displayName).trim(),
            transmitters: Array.isArray(rawOption?.transmitters) ? rawOption.transmitters : [],
        };
    }
    if (targetType === TARGET_TYPES.BODY) {
        const bodyId = String(rawOption?.body_id || rawOption?.bodyId || '').trim().toLowerCase();
        if (!bodyId) return null;
        const displayName = String(rawOption?.target_name || rawOption?.name || bodyId).trim();
        return {
            ...rawOption,
            id: String(rawOption?.id || `body:${bodyId}`),
            target_type: TARGET_TYPES.BODY,
            target_name: displayName,
            target_identifier: String(rawOption?.target_identifier || bodyId).trim().toLowerCase(),
            body_id: bodyId,
            name: String(rawOption?.name || displayName).trim(),
            transmitters: Array.isArray(rawOption?.transmitters) ? rawOption.transmitters : [],
        };
    }
    const noradId = rawOption?.norad_id;
    if (noradId == null || String(noradId).trim().length === 0) {
        return null;
    }
    const displayName = String(rawOption?.target_name || rawOption?.name || noradId).trim();
    return {
        ...rawOption,
        id: String(rawOption?.id || `satellite:${noradId}`),
        target_type: TARGET_TYPES.SATELLITE,
        target_name: displayName,
        target_identifier: String(rawOption?.target_identifier || noradId).trim(),
        norad_id: noradId,
        name: String(rawOption?.name || displayName).trim(),
        name_other: String(rawOption?.name_other || '').trim(),
        alternative_name: String(rawOption?.alternative_name || '').trim(),
        groups: Array.isArray(rawOption?.groups) ? rawOption.groups : [],
        transmitters: Array.isArray(rawOption?.transmitters) ? rawOption.transmitters : [],
    };
};

const buildOptionLabel = (option) => {
    if (!option) return '';
    if (option?.target_type === TARGET_TYPES.SATELLITE) {
        const noradId = String(option?.norad_id ?? '').trim();
        const targetName = String(option?.target_name || option?.name || '').trim();
        if (noradId && targetName) {
            return `${noradId} - ${targetName}`;
        }
        return targetName || noradId;
    }
    return String(option?.target_name || option?.display_name || option?.name || option?.command || option?.body_id || '').trim();
};

const buildOptionSearchText = (option) => {
    if (!option || typeof option !== 'object') {
        return '';
    }
    const targetType = String(option?.target_type || '').trim().toLowerCase();
    if (targetType === TARGET_TYPES.MISSION) {
        return [
            option?.target_name,
            option?.display_name,
            option?.command,
            option?.target_identifier,
            option?.target_type,
            'mission',
            'spacecraft',
            option?.mission_status,
        ]
            .map((value) => String(value || '').trim().toLowerCase())
            .filter(Boolean)
            .join(' ');
    }
    if (targetType === TARGET_TYPES.BODY) {
        return [
            option?.target_name,
            option?.name,
            option?.body_id,
            option?.target_identifier,
            option?.target_type,
            option?.body_type,
            option?.parent_body_id,
            'body',
            'celestial',
        ]
            .map((value) => String(value || '').trim().toLowerCase())
            .filter(Boolean)
            .join(' ');
    }
    return [
        option?.target_name,
        option?.name,
        option?.name_other,
        option?.alternative_name,
        option?.norad_id,
        option?.target_identifier,
        option?.target_type,
        'satellite',
    ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');
};

const SatelliteSearchAutocomplete = React.memo(function SatelliteSearchAutocomplete({
    onTargetSelect,
    disabled = false,
    monitoredMissionCommands = [],
    monitoredBodyIds = [],
}) {
    const {socket} = useSocket();
    const { t } = useTranslation('target');
    const [open, setOpen] = React.useState(false);
    const [value, setValue] = React.useState(null);
    const [inputValue, setInputValue] = React.useState('');
    const [options, setOptions] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const requestRef = React.useRef(0);
    const monitoredMissionSet = React.useMemo(
        () => new Set((Array.isArray(monitoredMissionCommands) ? monitoredMissionCommands : []).map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)),
        [monitoredMissionCommands],
    );
    const monitoredBodySet = React.useMemo(
        () => new Set((Array.isArray(monitoredBodyIds) ? monitoredBodyIds : []).map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)),
        [monitoredBodyIds],
    );
    const retargetHint = t('target_search.retarget_hint', {
        defaultValue: 'Search satellites, missions, or bodies. Selecting a result immediately retargets the active target.'
    });
    const searchLabel = t('target_search.search_label', {
        defaultValue: 'Search satellites, missions, or bodies',
    });

    React.useEffect(() => {
        if (!socket || disabled || !open) {
            return;
        }
        const keyword = String(inputValue || '').trim();
        if (keyword.length < 3) {
            setOptions([]);
            setLoading(false);
            return;
        }
        const requestId = requestRef.current + 1;
        requestRef.current = requestId;
        const timer = setTimeout(() => {
            setLoading(true);
            socket.emit("api.call", {
  cmd: "get-target-search",
  data: {
    query: keyword,
    limit: 20
  }
}, response => {
  if (requestId !== requestRef.current) {
    return;
  }
  if (response?.success) {
    const nextOptions = (Array.isArray(response?.data) ? response.data : []).map(entry => normalizeTargetOption(entry)).filter(Boolean);
    setOptions(nextOptions);
  } else {
    toast.error(response?.error || 'Error searching targets', {
      autoClose: 5000
    });
    setOptions([]);
  }
  setLoading(false);
});
        }, 220);
        return () => clearTimeout(timer);
    }, [disabled, inputValue, open, socket]);

    const handleOpen = () => {
        if (disabled) {
            return;
        }
        setOpen(true);
    };

    const handleClose = (event, reason) => {
        setOpen(false);
        if (reason !== 'selectOption') {
            setOptions([]);
        }
    };

    const handleInputChange = (event, newInputValue, reason) => {
        if (disabled) {
            return;
        }
        if (reason === 'reset') {
            return;
        }
        setInputValue(newInputValue);
        if (String(newInputValue || '').trim().length < 3) {
            setOptions([]);
            setLoading(false);
        }
    };

    const handleOptionSelect = (event, selectedTarget, reason) => {
        if (disabled) {
            return;
        }
        if (reason !== 'selectOption' || selectedTarget === null) {
            return;
        }
        onTargetSelect?.(selectedTarget);
        setValue(null);
        setInputValue('');
        setOpen(false);
        setOptions([]);
    };

    React.useEffect(() => {
        if (!disabled) {
            return;
        }
        setOpen(false);
        setValue(null);
        setInputValue('');
        setOptions([]);
        setLoading(false);
    }, [disabled]);

    const isMonitoredOption = React.useCallback((option) => {
        if (!option) return false;
        if (option?.target_type === TARGET_TYPES.MISSION) {
            return monitoredMissionSet.has(String(option?.command || '').trim().toLowerCase());
        }
        if (option?.target_type === TARGET_TYPES.BODY) {
            return monitoredBodySet.has(String(option?.body_id || '').trim().toLowerCase());
        }
        return false;
    }, [monitoredBodySet, monitoredMissionSet]);
    const filterOptions = React.useCallback((candidateOptions, state) => {
        const keyword = String(state?.inputValue || '').trim().toLowerCase();
        if (!keyword) {
            return candidateOptions;
        }
        return candidateOptions.filter((option) => buildOptionSearchText(option).includes(keyword));
    }, []);

    return (
        <Autocomplete
            size="small"
            sx={{ minWidth: 240, margin: 0, flex: 1 }}
            disabled={disabled}
            open={open}
            value={value}
            inputValue={inputValue}
            fullWidth={true}
            onOpen={handleOpen}
            onClose={handleClose}
            onInputChange={handleInputChange}
            onChange={handleOptionSelect}
            isOptionEqualToValue={(option, selectedValue) => option?.id === selectedValue?.id}
            getOptionLabel={buildOptionLabel}
            filterOptions={filterOptions}
            options={options}
            loading={loading}
            PaperComponent={(paperProps) => (
                <Paper {...paperProps}>
                    <Box sx={{ px: 1.5, py: 1 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.25 }}>
                            {retargetHint}
                        </Typography>
                    </Box>
                    <Divider />
                    {paperProps.children}
                </Paper>
            )}
            renderOption={(props, option) => {
                const targetType = String(option?.target_type || TARGET_TYPES.SATELLITE).toLowerCase();
                const secondaryLabel = targetType === TARGET_TYPES.SATELLITE
                    ? String(option?.norad_id || option?.target_identifier || '-')
                    : (targetType === TARGET_TYPES.MISSION
                        ? String(option?.command || option?.target_identifier || '-')
                        : String(option?.body_id || option?.target_identifier || '-'));
                const typeColor = targetType === TARGET_TYPES.SATELLITE
                    ? 'primary'
                    : (targetType === TARGET_TYPES.MISSION ? 'secondary' : 'info');
                const monitored = isMonitoredOption(option);
                const TypeIcon = TARGET_TYPE_ICON[targetType] || AdjustIcon;
                return (
                    <Box component="li" {...props} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, minWidth: 0, flex: 1 }}>
                            <TypeIcon
                                sx={{
                                    fontSize: '0.95rem',
                                    color: targetType === TARGET_TYPES.SATELLITE
                                        ? 'primary.main'
                                        : (targetType === TARGET_TYPES.MISSION ? 'secondary.main' : 'info.main'),
                                    flexShrink: 0,
                                }}
                            />
                            <Typography variant="body2" noWrap>
                                {String(option?.target_name || option?.display_name || option?.name || secondaryLabel || '-')}
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                            {monitored ? (
                                <Chip size="small" color="success" label="Monitored" sx={{ height: 18, fontSize: '0.62rem' }} />
                            ) : null}
                            <Chip
                                size="small"
                                color={typeColor}
                                label={TARGET_TYPE_LABEL[targetType] || 'Target'}
                                variant="outlined"
                                sx={{ height: 18, fontSize: '0.62rem' }}
                            />
                            <Chip
                                size="small"
                                label={secondaryLabel}
                                variant="outlined"
                                sx={{ height: 18, fontSize: '0.62rem', fontFamily: 'monospace' }}
                            />
                        </Box>
                    </Box>
                );
            }}
            renderInput={(params) => (
                <TextField
                    size="small"
                    fullWidth={true}
                    disabled={disabled}
                    {...params}
                    label={searchLabel}
                    slotProps={{
                        input: {
                            ...params.InputProps,
                            endAdornment: (
                                <Fragment>
                                    {loading ? <CircularProgress color="inherit" size={20} /> : null}
                                    {params.InputProps.endAdornment}
                                </Fragment>
                            ),
                        },
                    }}
                />
            )}
        />
    );
});

export default SatelliteSearchAutocomplete;
