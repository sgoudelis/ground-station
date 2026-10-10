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

import React, { useState, useEffect, useRef } from 'react';
import {
    Typography,
    Button,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Box,
    CircularProgress,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    FormControlLabel,
    Checkbox,
    Alert,
    Divider,
    Backdrop,
    LinearProgress
} from '@mui/material';
import { Download, Upload, Backup } from '@mui/icons-material';
import { v4 as uuidv4 } from 'uuid';
import { useSocket } from '../../common/socket.jsx';
import { toast } from '../../../utils/toast-with-timestamp.jsx';
import { useTranslation } from 'react-i18next';

const FULL_RESTORE_MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024;
const FULL_RESTORE_MAX_FILE_SIZE_MB = FULL_RESTORE_MAX_FILE_SIZE_BYTES / (1024 * 1024);

const uploadFullRestore = (file, dropTables, onUploadProgress) => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `/api/database/restore?drop_tables=${dropTables}`);
    request.withCredentials = true;
    request.setRequestHeader('Content-Type', 'application/sql');

    request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
            onUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
    };
    request.onerror = () => reject(new Error('Network error while uploading database backup'));
    request.onload = () => {
        let response = null;
        try {
            response = JSON.parse(request.responseText);
        } catch {
            // A reverse proxy may return a non-JSON error page for an interrupted upload.
        }

        if (request.status >= 200 && request.status < 300 && response?.success) {
            resolve(response);
            return;
        }
        reject(new Error(response?.detail || response?.error || 'Failed to restore database backup'));
    };
    request.send(file);
});

const DatabaseBackupCard = () => {
    const { t } = useTranslation('settings');
    const { socket } = useSocket();
    const [tables, setTables] = useState([]);
    const [loading, setLoading] = useState(false);
    const [restoreDialog, setRestoreDialog] = useState({ open: false, table: null });
    const [deleteBeforeRestore, setDeleteBeforeRestore] = useState(true);
    const [selectedFile, setSelectedFile] = useState(null);
    const [fullRestoreDialog, setFullRestoreDialog] = useState(false);
    const [fullRestoreFile, setFullRestoreFile] = useState(null);
    const [dropTables, setDropTables] = useState(true);
    const [fullRestoreProgress, setFullRestoreProgress] = useState(null);
    const [showReloadBackdrop, setShowReloadBackdrop] = useState(false);
    const [fullBackup, setFullBackup] = useState({ isRunning: false, isCancelling: false, progress: null });
    const backupOperationIdRef = useRef(null);

    useEffect(() => {
        if (socket) {
            loadTables();
        }
    }, [socket]);

    useEffect(() => {
        if (!socket) return undefined;

        const handleFullBackupProgress = (progress) => {
            if (progress?.operation_id !== backupOperationIdRef.current) return;
            setFullBackup((current) => ({ ...current, progress }));
        };

        socket.on('database-backup:progress', handleFullBackupProgress);
        return () => socket.off('database-backup:progress', handleFullBackupProgress);
    }, [socket]);

    const loadTables = async () => {
        if (!socket) return;

        setLoading(true);
        try {
            const response = await socket.emitWithAck('api.call', {
                cmd: 'database-backup.list_tables',
                data: {
                    action: 'list_tables'
                }
            });

            if (response.success) {
                setTables(response.tables);
            } else {
                toast.error(`Failed to load tables: ${response.error}`);
            }
        } catch (error) {
            toast.error(`Error loading tables: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleBackupTable = async (tableName) => {
        if (!socket) return;

        try {
            const response = await socket.emitWithAck('api.call', {
                cmd: 'database-backup.backup_table',
                data: {
                    action: 'backup_table',
                    table: tableName
                }
            });

            if (response.success) {
                // Create a blob and download it
                const blob = new Blob([response.sql], { type: 'text/plain' });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${tableName}_backup_${new Date().toISOString().split('T')[0]}.sql`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);

                toast.success(`Table ${tableName} backed up successfully`);
            } else {
                toast.error(`Failed to backup table: ${response.error}`);
            }
        } catch (error) {
            toast.error(`Error backing up table: ${error.message}`);
        }
    };

    const handleRestoreTable = (tableName) => {
        setRestoreDialog({ open: true, table: tableName });
        setSelectedFile(null);
        setDeleteBeforeRestore(true);
    };

    const handleFileSelect = (event) => {
        const file = event.target.files[0];
        if (file) {
            setSelectedFile(file);
        }
    };

    const handleRestoreConfirm = async () => {
        if (!socket || !selectedFile || !restoreDialog.table) return;

        try {
            const sqlContent = await selectedFile.text();

            const response = await socket.emitWithAck('api.call', {
                cmd: 'database-backup.restore_table',
                data: {
                    action: 'restore_table',
                    table: restoreDialog.table,
                    sql: sqlContent,
                    delete_first: deleteBeforeRestore
                }
            });

            if (response.success) {
                toast.success(`Table ${restoreDialog.table} restored successfully (${response.rows_inserted} rows inserted)`);
                setRestoreDialog({ open: false, table: null });
                setSelectedFile(null);
            } else {
                toast.error(`Failed to restore table: ${response.error}`);
            }
        } catch (error) {
            toast.error(`Error restoring table: ${error.message}`);
        }
    };

    const handleFullBackup = async () => {
        if (!socket) return;

        const operationId = uuidv4();
        backupOperationIdRef.current = operationId;
        setFullBackup({ isRunning: true, isCancelling: false, progress: null });

        try {
            const response = await socket.emitWithAck('api.call', {
                cmd: 'database-backup.full_backup',
                data: {
                    action: 'full_backup',
                    operation_id: operationId
                }
            });

            if (response.success && response.cancelled) {
                toast.info('Full database backup cancelled');
            } else if (response.success) {
                // Create a blob and download it
                const blob = new Blob([response.sql], { type: 'text/plain' });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `full_database_backup_${new Date().toISOString().split('T')[0]}.sql`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);

                toast.success('Full database backup completed successfully');
            } else {
                toast.error(`Failed to backup database: ${response.error}`);
            }
        } catch (error) {
            toast.error(`Error backing up database: ${error.message}`);
        } finally {
            if (backupOperationIdRef.current === operationId) {
                backupOperationIdRef.current = null;
                setFullBackup({ isRunning: false, isCancelling: false, progress: null });
            }
        }
    };

    const handleCancelFullBackup = async () => {
        const operationId = backupOperationIdRef.current;
        if (!socket || !operationId) return;

        setFullBackup((current) => ({ ...current, isCancelling: true }));
        try {
            const response = await socket.emitWithAck('api.call', {
                cmd: 'database-backup.cancel_full_backup',
                data: { operation_id: operationId }
            });

            if (!response.success) {
                setFullBackup((current) => ({ ...current, isCancelling: false }));
                toast.error(`Failed to cancel database backup: ${response.error}`);
            }
        } catch (error) {
            setFullBackup((current) => ({ ...current, isCancelling: false }));
            toast.error(`Error cancelling database backup: ${error.message}`);
        }
    };

    const handleFullRestoreOpen = () => {
        setFullRestoreDialog(true);
        setFullRestoreFile(null);
        setDropTables(true);
        setFullRestoreProgress(null);
    };

    const handleFullRestoreFileSelect = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        if (file.size > FULL_RESTORE_MAX_FILE_SIZE_BYTES) {
            toast.error(
                `Full restore file is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max allowed is ${FULL_RESTORE_MAX_FILE_SIZE_MB} MB.`
            );
            setFullRestoreFile(null);
            event.target.value = '';
            return;
        }

        setFullRestoreFile(file);
    };

    const handleFullRestoreConfirm = async () => {
        if (!fullRestoreFile) return;

        if (fullRestoreFile.size > FULL_RESTORE_MAX_FILE_SIZE_BYTES) {
            toast.error(
                `Selected file exceeds ${FULL_RESTORE_MAX_FILE_SIZE_MB} MB limit. Please choose a smaller backup file.`
            );
            return;
        }

        setLoading(true);
        setFullRestoreProgress(0);
        try {
            const response = await uploadFullRestore(fullRestoreFile, dropTables, setFullRestoreProgress);
            toast.success(
                `Full database restored successfully!\n${response.tables_created} tables created, ${response.rows_inserted} rows inserted`
            );
            setFullRestoreDialog(false);
            setFullRestoreFile(null);

            // A restored database can replace the active account/session; reload to re-authenticate.
            setShowReloadBackdrop(true);
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } catch (error) {
            toast.error(`Error restoring database: ${error.message}`);
        } finally {
            setLoading(false);
            setFullRestoreProgress(null);
        }
    };

    const backupProgress = fullBackup.progress;
    const tableProgress = backupProgress?.tables_total
        ? Math.round((backupProgress.tables_completed / backupProgress.tables_total) * 100)
        : null;
    const backupStatus = fullBackup.isCancelling
        ? 'Cancelling full database backup...'
        : backupProgress?.phase === 'table'
            ? `Backing up ${backupProgress.table_name} (table ${backupProgress.tables_completed + 1} of ${backupProgress.tables_total})${backupProgress.rows_total ? ` — ${backupProgress.rows_processed.toLocaleString()} of ${backupProgress.rows_total.toLocaleString()} rows` : ''}`
            : 'Preparing full database backup...';

    return (
        <>
            <Typography variant="h6" gutterBottom>
                {t('database_backup_card.database_backup_restore', { defaultValue: 'Database Backup & Restore' })}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {t('database_backup_card.manage_full_database_backups_and_individual_table_operat', { defaultValue: 'Manage full database backups and individual table operations' })}
            </Typography>

                    {/* Full Database Backup/Restore Section */}
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                            {t('database_backup_card.full_database_operations', { defaultValue: 'Full Database Operations' })}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            {t('database_backup_card.create_or_restore_complete_database_backups_including_sc', { defaultValue: 'Create or restore complete database backups including schema and all data' })}
                        </Typography>

                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                            <Button
                                variant="contained"
                                color="primary"
                                startIcon={<Backup />}
                                onClick={handleFullBackup}
                                disabled={loading || fullBackup.isRunning}
                            >
                                {t('database_backup_card.full_database_backup', { defaultValue: 'Full Database Backup' })}
                            </Button>
                            <Button
                                variant="contained"
                                color="warning"
                                startIcon={<Upload />}
                                onClick={handleFullRestoreOpen}
                                disabled={loading || fullBackup.isRunning}
                            >
                                {t('database_backup_card.full_database_restore', { defaultValue: 'Full Database Restore' })}
                            </Button>
                        </Box>
                    </Box>

            <Divider sx={{ my: 3 }} />

                    {/* Individual Table Operations Section */}
                    <Box>
                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                            {t('database_backup_card.individual_table_operations', { defaultValue: 'Individual Table Operations' })}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            {t('database_backup_card.backup_or_restore_specific_tables_data_only_no_schema', { defaultValue: 'Backup or restore specific tables (data only, no schema)' })}
                        </Typography>

                        <Alert severity="info" sx={{ mb: 2 }}>
                            {t('database_backup_card.table_backups_contain_only_insert_statements_data_schema', { defaultValue: 'Table backups contain only INSERT statements (data). Schema is NOT included.' })}
                        </Alert>

                        {loading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                                <CircularProgress />
                            </Box>
                        ) : (
                            <TableContainer component={Paper} variant="outlined">
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>{t('database_backup_card.table_name', { defaultValue: 'Table Name' })}</TableCell>
                                            <TableCell align="center">{t('database_backup_card.row_count', { defaultValue: 'Row Count' })}</TableCell>
                                            <TableCell align="right">{t('database_backup_card.actions', { defaultValue: 'Actions' })}</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {tables.map((table) => (
                                            <TableRow
                                                key={table.name}
                                                sx={{
                                                    '&:hover': {
                                                        backgroundColor: 'action.hover'
                                                    }
                                                }}
                                            >
                                                <TableCell component="th" scope="row">
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                        {table.name}
                                                    </Typography>
                                                </TableCell>
                                                <TableCell align="center">
                                                    <Typography variant="body2">
                                                        {table.row_count}
                                                    </Typography>
                                                </TableCell>
                                                <TableCell align="right">
                                                    <Button
                                                        size="small"
                                                        startIcon={<Download />}
                                                        onClick={() => handleBackupTable(table.name)}
                                                        sx={{ mr: 1 }}
                                                        disabled={fullBackup.isRunning}
                                                    >
                                                        {t('database_backup_card.backup', { defaultValue: 'Backup' })}
                                                    </Button>
                                                    <Button
                                                        size="small"
                                                        startIcon={<Upload />}
                                                        onClick={() => handleRestoreTable(table.name)}
                                                        color="warning"
                                                        disabled={fullBackup.isRunning}
                                                    >
                                                        {t('database_backup_card.restore', { defaultValue: 'Restore' })}
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </Box>

            <Dialog open={restoreDialog.open} onClose={() => setRestoreDialog({ open: false, table: null })}>
                <DialogTitle>{t('database_backup_card.restore_table', { defaultValue: 'Restore Table:' })} {restoreDialog.table}</DialogTitle>
                <DialogContent>
                    <Box sx={{ minWidth: 400 }}>
                        <Alert severity="warning" sx={{ mb: 2 }}>
                            {t('database_backup_card.this_operation_will_modify_the_database_make_sure_you_ha', { defaultValue: 'This operation will modify the database. Make sure you have a backup!' })}
                        </Alert>

                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={deleteBeforeRestore}
                                    onChange={(e) => setDeleteBeforeRestore(e.target.checked)}
                                />
                            }
                            label={t('database_backup_card.delete_all_rows_before_restoring', { defaultValue: 'Delete all rows before restoring' })}
                        />

                        <Box sx={{ mt: 2 }}>
                            <Button
                                variant="outlined"
                                component="label"
                                fullWidth
                            >
                                {t('database_backup_card.select_sql_file', { defaultValue: 'Select SQL File' })}
                                <input
                                    type="file"
                                    hidden
                                    accept=".sql"
                                    onChange={handleFileSelect}
                                />
                            </Button>
                            {selectedFile && (
                                <Typography variant="body2" sx={{ mt: 1 }}>
                                    {t('database_backup_card.selected', { defaultValue: 'Selected:' })} {selectedFile.name}
                                </Typography>
                            )}
                        </Box>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRestoreDialog({ open: false, table: null })}>
                        {t('database_backup_card.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button
                        onClick={handleRestoreConfirm}
                        variant="contained"
                        color="warning"
                        disabled={!selectedFile}
                    >
                        {t('database_backup_card.restore', { defaultValue: 'Restore' })}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Full Database Restore Dialog */}
            <Dialog open={fullRestoreDialog} onClose={() => setFullRestoreDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{t('database_backup_card.full_database_restore', { defaultValue: 'Full Database Restore' })}</DialogTitle>
                <DialogContent>
                    <Box sx={{ minWidth: 400, pt: 2.5 }}>
                        <Alert severity="error" sx={{ mb: 2 }}>
                            <strong>{t('database_backup_card.destructive_operation', { defaultValue: '⚠️ DESTRUCTIVE OPERATION!' })}</strong><br />
                            {t('database_backup_card.this_will_replace_your_entire_database_with_the_backup_f', { defaultValue: 'This will replace your entire database with the backup file.\n                            All current data will be lost if "Drop existing tables" is checked.\n                            Make sure you have a recent backup before proceeding! After restoring,\n                            sign in with an administrator account from the restored database.' })}
                        </Alert>

                        <Alert severity="info" sx={{ mb: 2 }}>
                            {t('database_backup_card.the_backup_file_must_be_a_full_database_backup_containin', { defaultValue: 'The backup file must be a full database backup containing both schema (CREATE TABLE statements) and data (INSERT statements).' })}
                        </Alert>

                        <Alert severity="info" sx={{ mb: 2 }}>
                            {t('database_backup_card.maximum_full_restore_file_size', { defaultValue: 'Maximum full restore file size:' })} {FULL_RESTORE_MAX_FILE_SIZE_MB} {t('database_backup_card.mb', { defaultValue: 'MB.' })}
                        </Alert>

                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={dropTables}
                                    onChange={(e) => setDropTables(e.target.checked)}
                                />
                            }
                            label={t('database_backup_card.drop_existing_tables_before_restore_recommended', { defaultValue: 'Drop existing tables before restore (recommended)' })}
                        />

                        <Box sx={{ mt: 2 }}>
                            <Button
                                variant="outlined"
                                component="label"
                                fullWidth
                            >
                                {t('database_backup_card.select_full_backup_sql_file', { defaultValue: 'Select Full Backup SQL File' })}
                                <input
                                    type="file"
                                    hidden
                                    accept=".sql"
                                    onChange={handleFullRestoreFileSelect}
                                />
                            </Button>
                            {fullRestoreFile && (
                                <Typography variant="body2" sx={{ mt: 1 }}>
                                    {t('database_backup_card.selected', { defaultValue: 'Selected:' })} {fullRestoreFile.name}
                                </Typography>
                            )}
                        </Box>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setFullRestoreDialog(false)} disabled={loading}>
                        {t('database_backup_card.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button
                        onClick={handleFullRestoreConfirm}
                        variant="contained"
                        color="error"
                        disabled={!fullRestoreFile || loading}
                    >
                        {loading ? (
                            <>
                                <CircularProgress size={20} sx={{ mr: 1 }} />
                                {fullRestoreProgress === 100
                                    ? 'Restoring database...'
                                    : `Uploading backup... ${fullRestoreProgress ?? 0}%`}
                            </>
                        ) : 'Restore Full Database'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Keep backup progress visible even when the database tab is busy with a large export. */}
            <Dialog
                open={fullBackup.isRunning}
                disableEscapeKeyDown
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>{t('database_backup_card.creating_full_database_backup', { defaultValue: 'Creating Full Database Backup' })}</DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, pt: 1 }}>
                        <CircularProgress size={28} />
                        <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body1">{backupStatus}</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                {t('database_backup_card.large_databases_can_take_several_minutes_keep_this_page_', { defaultValue: 'Large databases can take several minutes. Keep this page open until the download starts.' })}
                            </Typography>
                        </Box>
                    </Box>
                    <LinearProgress
                        variant={tableProgress === null ? 'indeterminate' : 'determinate'}
                        value={tableProgress ?? undefined}
                        sx={{ mt: 3 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={handleCancelFullBackup}
                        disabled={fullBackup.isCancelling}
                        color="warning"
                    >
                        {fullBackup.isCancelling ? 'Cancelling...' : 'Cancel backup'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Backdrop spinner for page reload */}
            <Backdrop
                sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }}
                open={showReloadBackdrop}
            >
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <CircularProgress color="inherit" size={60} />
                    <Typography variant="h6" sx={{ mt: 2 }}>
                        {t('database_backup_card.reloading_application', { defaultValue: 'Reloading application...' })}
                    </Typography>
                </Box>
            </Backdrop>
        </>
    );
};

export default DatabaseBackupCard;
