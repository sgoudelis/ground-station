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

import React, { useState, useMemo, memo } from 'react';
import {
    Typography, Divider, Button, TextField, Alert, AlertTitle,
    Tabs, Tab, Box, IconButton, Collapse, Dialog, DialogTitle,
    DialogContent, DialogActions, Tooltip, Chip, Select, MenuItem, FormControl, InputLabel
} from '@mui/material';
import Grid from '@mui/material/Grid';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';
import SearchIcon from '@mui/icons-material/Search';
import WarningIcon from '@mui/icons-material/Warning';
import { useSelector, useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';

const ReduxStateInspectorCard = () => {
    const { t } = useTranslation('settings');
    const fullState = useSelector((state) => state);
    const dispatch = useDispatch();

    const [activeTab, setActiveTab] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedKeys, setExpandedKeys] = useState(new Set());
    const [editingPath, setEditingPath] = useState(null);
    const [editingValue, setEditingValue] = useState('');
    const [editingType, setEditingType] = useState('string');
    const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
    const [pendingEdit, setPendingEdit] = useState(null);
    const [copySuccess, setCopySuccess] = useState(false);

    // Edit mode always enabled
    const isEditEnabled = true;

    // Toggle expand/collapse for a key
    const toggleExpand = (path) => {
        const newExpanded = new Set(expandedKeys);
        if (newExpanded.has(path)) {
            newExpanded.delete(path);
        } else {
            newExpanded.add(path);
        }
        setExpandedKeys(newExpanded);
    };

    // Copy to clipboard
    const copyToClipboard = (value) => {
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        navigator.clipboard.writeText(text).then(() => {
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        });
    };

    // Download state as JSON
    const downloadState = () => {
        const dataStr = JSON.stringify(fullState, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `redux-state-${new Date().toISOString()}.json`;
        link.click();
        URL.revokeObjectURL(url);
    };

    // Detect type of value
    const detectType = (value) => {
        if (value === null) return 'null';
        if (Array.isArray(value)) return 'array';
        if (typeof value === 'object') return 'object';
        if (typeof value === 'boolean') return 'boolean';
        if (typeof value === 'number') return 'number';
        return 'string';
    };

    // Start editing a value
    const startEdit = (path, value) => {
        setEditingPath(path);
        const type = detectType(value);
        setEditingType(type);

        if (type === 'object' || type === 'array') {
            setEditingValue(JSON.stringify(value, null, 2));
        } else if (type === 'null') {
            setEditingValue('');
        } else {
            setEditingValue(String(value));
        }
    };

    // Cancel editing
    const cancelEdit = () => {
        setEditingPath(null);
        setEditingValue('');
        setEditingType('string');
    };

    // Confirm edit
    const confirmEdit = (path, newValue, type) => {
        setPendingEdit({ path, newValue, type });
        setConfirmDialogOpen(true);
    };

    // Convert value based on type
    const convertValueByType = (value, type) => {
        switch (type) {
            case 'string':
                return String(value);
            case 'number': {
                const num = Number(value);
                if (isNaN(num)) throw new Error('Invalid number');
                return num;
            }
            case 'boolean':
                if (value === 'true' || value === '1') return true;
                if (value === 'false' || value === '0') return false;
                throw new Error('Invalid boolean (use true/false or 1/0)');
            case 'null':
                return null;
            case 'object':
            case 'array':
                return JSON.parse(value);
            default:
                return value;
        }
    };

    // Apply edit (dispatch action to update state)
    const applyEdit = () => {
        if (!pendingEdit) return;

        const { path, newValue, type } = pendingEdit;
        const pathParts = path.split('.');
        const sliceName = pathParts[0];

        try {
            const parsedValue = convertValueByType(newValue, type);

            // Create a custom action to update the state
            // This assumes your slices have a generic update action
            // You may need to adjust this based on your actual slice structure
            dispatch({
                type: `${sliceName}/updateState`,
                payload: {
                    path: pathParts.slice(1).join('.'),
                    value: parsedValue
                }
            });

            setConfirmDialogOpen(false);
            setPendingEdit(null);
            cancelEdit();
        } catch (error) {
            alert(`Invalid value: ${error.message}`);
        }
    };

    // Memoized recursive component to render state tree
    const StateTreeNode = memo(({ data, path = '', depth = 0 }) => {
        const { t } = useTranslation('settings');
        if (data === null || data === undefined) {
            return (
                <Box sx={{ color: 'text.secondary', fontFamily: 'monospace', display: 'inline' }}>
                    {String(data)}
                </Box>
            );
        }

        if (typeof data !== 'object') {
            return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'primary.main', lineHeight: '20px' }}>
                        {typeof data === 'string' ? `"${data}"` : String(data)}
                    </Typography>
                    <IconButton size="small" onClick={() => copyToClipboard(data)} sx={{ padding: '2px' }}>
                        <ContentCopyIcon fontSize="small" />
                    </IconButton>
                    {isEditEnabled && (
                        <IconButton size="small" onClick={() => startEdit(path, data)} sx={{ padding: '2px' }}>
                            <EditIcon fontSize="small" />
                        </IconButton>
                    )}
                </Box>
            );
        }

        const isArray = Array.isArray(data);
        const keys = Object.keys(data);
        const isExpanded = expandedKeys.has(path);

        // Filter by search query
        const matchesSearch = !searchQuery ||
            path.toLowerCase().includes(searchQuery.toLowerCase()) ||
            JSON.stringify(data).toLowerCase().includes(searchQuery.toLowerCase());

        if (!matchesSearch && depth > 0) return null;

        return (
            <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                    <IconButton size="small" onClick={() => toggleExpand(path)} sx={{ padding: '2px' }}>
                        {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                    </IconButton>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 'bold', color: 'text.secondary', lineHeight: '20px' }}>
                        {isArray ? `[${keys.length}]` : `{${keys.length}}`}
                    </Typography>
                    <IconButton size="small" onClick={() => copyToClipboard(data)} sx={{ padding: '2px' }}>
                        <ContentCopyIcon fontSize="small" />
                    </IconButton>
                    {isEditEnabled && (
                        <IconButton size="small" onClick={() => startEdit(path, data)} sx={{ padding: '2px' }}>
                            <EditIcon fontSize="small" />
                        </IconButton>
                    )}
                </Box>
                {/* Only render children when expanded - critical for performance */}
                {isExpanded && (
                    <Box sx={{ borderLeft: '2px solid', borderColor: 'divider', pl: 1, ml: 2 }}>
                        {keys.map((key) => {
                            const childPath = path ? `${path}.${key}` : key;
                            const childData = data[key];
                            const isChildObject = childData !== null && typeof childData === 'object';

                            return (
                                <Box key={key} sx={{ mb: 0.5, display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary', minWidth: 'fit-content' }}>
                                        {key}:
                                    </Typography>
                                    <Box sx={{ flex: 1 }}>
                                        <StateTreeNode
                                            data={childData}
                                            path={childPath}
                                            depth={depth + 1}
                                        />
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                )}
            </Box>
        );
    });

    return (
        <>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">
                    {t('redux_state_inspector_card.redux_state_inspector', { defaultValue: 'Redux State Inspector' })}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Tooltip title={t('redux_state_inspector_card.copy_entire_state', { defaultValue: 'Copy entire state' })}>
                        <IconButton onClick={() => copyToClipboard(fullState)} color={copySuccess ? 'success' : 'default'}>
                            <ContentCopyIcon />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t('redux_state_inspector_card.download_state_as_json', { defaultValue: 'Download state as JSON' })}>
                        <IconButton onClick={downloadState}>
                            <DownloadIcon />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>
            <Divider sx={{ mb: 2 }} />

            <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)} sx={{ mb: 2 }}>
                <Tab label={t('redux_state_inspector_card.inspector', { defaultValue: 'Inspector' })} />
                <Tab label={t('redux_state_inspector_card.raw_json', { defaultValue: 'Raw JSON' })} />
            </Tabs>

                {/* Tab 0: Inspector with View and Edit side by side */}
                {activeTab === 0 && (
                    <Grid container spacing={2}>
                        {/* Left side: View */}
                        <Grid size={{ xs: 12, md: 6 }}>
                            <TextField
                                fullWidth
                                size="small"
                                placeholder={t('redux_state_inspector_card.search_state_keys_or_values', { defaultValue: 'Search state keys or values...' })}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                InputProps={{
                                    startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                                }}
                                sx={{ mb: 2 }}
                            />
                            <Box sx={{
                                height: '500px',
                                overflowY: 'auto',
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 1,
                                p: 2,
                                bgcolor: 'background.default'
                            }}>
                                <StateTreeNode data={fullState} />
                            </Box>
                        </Grid>

                        {/* Right side: Edit */}
                        <Grid size={{ xs: 12, md: 6 }}>
                                <Box>
                                    <Typography variant="body1" sx={{ mb: 1.5, fontFamily: 'monospace', fontWeight: 'medium' }}>
                                        {editingPath ? (
                                            <>
                                                <span style={{ color: 'inherit', fontSize: '0.95rem' }}>{t('redux_state_inspector_card.editing', { defaultValue: 'Editing:' })} </span>
                                                {editingPath.split('.').map((segment, index, array) => (
                                                    <React.Fragment key={index}>
                                                        <span style={{ color: `hsl(${(index * 80) % 360}, 70%, 45%)`, fontWeight: 'bold', fontSize: '1rem' }}>
                                                            {segment}
                                                        </span>
                                                        {index < array.length - 1 && <span style={{ color: 'gray', fontWeight: 'bold' }}>.</span>}
                                                    </React.Fragment>
                                                ))}
                                            </>
                                        ) : (
                                            <span style={{ color: 'gray' }}>{t('redux_state_inspector_card.no_path_selected', { defaultValue: 'No path selected' })}</span>
                                        )}
                                    </Typography>

                                    <FormControl fullWidth size="small" sx={{ mb: 2 }} disabled={!editingPath}>
                                        <InputLabel>{t('redux_state_inspector_card.data_type', { defaultValue: 'Data Type' })}</InputLabel>
                                        <Select
                                            value={editingType}
                                            onChange={(e) => setEditingType(e.target.value)}
                                            label={t('redux_state_inspector_card.data_type', { defaultValue: 'Data Type' })}
                                        >
                                            <MenuItem value="string">{t('redux_state_inspector_card.string', { defaultValue: 'String' })}</MenuItem>
                                            <MenuItem value="number">{t('redux_state_inspector_card.number', { defaultValue: 'Number' })}</MenuItem>
                                            <MenuItem value="boolean">{t('redux_state_inspector_card.boolean', { defaultValue: 'Boolean' })}</MenuItem>
                                            <MenuItem value="null">{t('redux_state_inspector_card.null', { defaultValue: 'Null' })}</MenuItem>
                                            <MenuItem value="object">{t('redux_state_inspector_card.object', { defaultValue: 'Object' })}</MenuItem>
                                            <MenuItem value="array">{t('redux_state_inspector_card.array', { defaultValue: 'Array' })}</MenuItem>
                                        </Select>
                                    </FormControl>

                                    <TextField
                                        fullWidth
                                        multiline
                                        rows={12}
                                        minRows={12}
                                        maxRows={12}
                                        value={editingPath ? editingValue : ''}
                                        onChange={(e) => setEditingValue(e.target.value)}
                                        disabled={!editingPath || editingType === 'null'}
                                        placeholder={
                                            !editingPath
                                                ? 'Click the edit icon next to any value in the state tree to start editing...'
                                                : editingType === 'null'
                                                ? 'Null value (no input needed)'
                                                : editingType === 'boolean'
                                                ? 'Enter: true/false or 1/0'
                                                : editingType === 'number'
                                                ? 'Enter a number (int or float)'
                                                : editingType === 'object'
                                                ? 'Enter valid JSON object: { "key": "value" }'
                                                : editingType === 'array'
                                                ? 'Enter valid JSON array: [1, 2, 3]'
                                                : 'Click the edit icon next to any value in the state tree to start editing...'
                                        }
                                        sx={{
                                            mb: 2,
                                            fontFamily: 'monospace',
                                            '& .MuiInputBase-input': {
                                                fontFamily: 'monospace'
                                            }
                                        }}
                                    />
                                    <Alert severity="warning" sx={{ mb: 2 }}>
                                        <AlertTitle>{t('redux_state_inspector_card.caution', { defaultValue: '⚠️ Caution' })}</AlertTitle>
                                        {t('redux_state_inspector_card.editing_redux_state_directly_can_cause_unexpected_behavi', { defaultValue: 'Editing Redux state directly can cause unexpected behavior.' })}
                                    </Alert>
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                        <Button
                                            variant="contained"
                                            color="primary"
                                            startIcon={<SaveIcon />}
                                            onClick={() => confirmEdit(editingPath, editingValue, editingType)}
                                            disabled={!editingPath}
                                        >
                                            {t('redux_state_inspector_card.save', { defaultValue: 'Save' })}
                                        </Button>
                                        <Button
                                            variant="outlined"
                                            startIcon={<CancelIcon />}
                                            onClick={cancelEdit}
                                            disabled={!editingPath}
                                        >
                                            {t('redux_state_inspector_card.cancel', { defaultValue: 'Cancel' })}
                                        </Button>
                                    </Box>
                                </Box>
                        </Grid>
                    </Grid>
                )}

                {/* Tab 1: Raw JSON */}
                {activeTab === 1 && (
                    <Box>
                        <TextField
                            fullWidth
                            multiline
                            rows={20}
                            value={JSON.stringify(fullState, null, 2)}
                            InputProps={{
                                readOnly: true,
                                sx: { fontFamily: 'monospace', fontSize: '0.875rem' }
                            }}
                        />
                    </Box>
                )}

            {/* Confirmation Dialog */}
            <Dialog open={confirmDialogOpen} onClose={() => setConfirmDialogOpen(false)}>
                <DialogTitle>{t('redux_state_inspector_card.confirm_state_change', { defaultValue: 'Confirm State Change' })}</DialogTitle>
                <DialogContent>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        {t('redux_state_inspector_card.you_are_about_to_modify_the_redux_state_directly', { defaultValue: 'You are about to modify the Redux state directly.' })}
                    </Alert>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                        <strong>{t('redux_state_inspector_card.path', { defaultValue: 'Path:' })}</strong> {pendingEdit?.path}
                    </Typography>
                    <Typography variant="body2">
                        <strong>{t('redux_state_inspector_card.new_value', { defaultValue: 'New Value:' })}</strong>
                    </Typography>
                    <Box sx={{
                        mt: 1,
                        p: 2,
                        bgcolor: 'background.default',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        fontFamily: 'monospace',
                        fontSize: '0.875rem',
                        maxHeight: '200px',
                        overflowY: 'auto'
                    }}>
                        {pendingEdit?.newValue}
                    </Box>
                    <Typography variant="body2" sx={{ mt: 2, color: 'warning.main' }}>
                        {t('redux_state_inspector_card.note_this_may_not_work_for_all_state_slices_some_slices_', { defaultValue: 'Note: This may not work for all state slices. Some slices may require specific action creators.' })}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmDialogOpen(false)}>{t('redux_state_inspector_card.cancel', { defaultValue: 'Cancel' })}</Button>
                    <Button onClick={applyEdit} color="warning" variant="contained">
                        {t('redux_state_inspector_card.apply_change', { defaultValue: 'Apply Change' })}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default ReduxStateInspectorCard;
