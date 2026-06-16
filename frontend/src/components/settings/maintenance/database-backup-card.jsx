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

import React, { useState, useEffect } from 'react';
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
    Backdrop
} from '@mui/material';
import { Download, Upload, Backup } from '@mui/icons-material';
import { useSocket } from '../../common/socket.jsx';
import { toast } from '../../../utils/toast-with-timestamp.jsx';

const FULL_RESTORE_MAX_FILE_SIZE_BYTES = 300 * 1024 * 1024;
const FULL_RESTORE_MAX_FILE_SIZE_MB = FULL_RESTORE_MAX_FILE_SIZE_BYTES / (1024 * 1024);

const DatabaseBackupCard = () => {
    const { socket } = useSocket();
    const [tables, setTables] = useState([]);
    const [loading, setLoading] = useState(false);
    const [restoreDialog, setRestoreDialog] = useState({ open: false, table: null });
    const [deleteBeforeRestore, setDeleteBeforeRestore] = useState(true);
    const [selectedFile, setSelectedFile] = useState(null);
    const [fullRestoreDialog, setFullRestoreDialog] = useState(false);
    const [fullRestoreFile, setFullRestoreFile] = useState(null);
    const [dropTables, setDropTables] = useState(true);
    const [showReloadBackdrop, setShowReloadBackdrop] = useState(false);

    useEffect(() => {
        if (socket) {
            loadTables();
        }
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

        try {
            const response = await socket.emitWithAck('api.call', {
                cmd: 'database-backup.full_backup',
                data: {
                    action: 'full_backup'
                }
            });

            if (response.success) {
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
        }
    };

    const handleFullRestoreOpen = () => {
        setFullRestoreDialog(true);
        setFullRestoreFile(null);
        setDropTables(true);
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
        if (!socket || !fullRestoreFile) return;

        if (fullRestoreFile.size > FULL_RESTORE_MAX_FILE_SIZE_BYTES) {
            toast.error(
                `Selected file exceeds ${FULL_RESTORE_MAX_FILE_SIZE_MB} MB limit. Please choose a smaller backup file.`
            );
            return;
        }

        setLoading(true);
        try {
            const sqlContent = await fullRestoreFile.text();

            const response = await socket.emitWithAck('api.call', {
                cmd: 'database-backup.full_restore',
                data: {
                    action: 'full_restore',
                    sql: sqlContent,
                    drop_tables: dropTables
                }
            });

            if (response.success) {
                toast.success(
                    `Full database restored successfully!\n${response.tables_created} tables created, ${response.rows_inserted} rows inserted`
                );
                setFullRestoreDialog(false);
                setFullRestoreFile(null);
                setLoading(false);

                // Show backdrop spinner and reload page after 1 second
                setShowReloadBackdrop(true);
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                toast.error(`Failed to restore database: ${response.error}`);
                setLoading(false);
            }
        } catch (error) {
            toast.error(`Error restoring database: ${error.message}`);
            setLoading(false);
        }
    };

    return (
        <>
            <Typography variant="h6" gutterBottom>
                Database Backup & Restore
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Manage full database backups and individual table operations
            </Typography>

                    {/* Full Database Backup/Restore Section */}
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                            Full Database Operations
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Create or restore complete database backups including schema and all data
                        </Typography>

                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                            <Button
                                variant="contained"
                                color="primary"
                                startIcon={<Backup />}
                                onClick={handleFullBackup}
                                disabled={loading}
                            >
                                Full Database Backup
                            </Button>
                            <Button
                                variant="contained"
                                color="warning"
                                startIcon={<Upload />}
                                onClick={handleFullRestoreOpen}
                                disabled={loading}
                            >
                                Full Database Restore
                            </Button>
                        </Box>
                    </Box>

            <Divider sx={{ my: 3 }} />

                    {/* Individual Table Operations Section */}
                    <Box>
                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                            Individual Table Operations
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Backup or restore specific tables (data only, no schema)
                        </Typography>

                        <Alert severity="info" sx={{ mb: 2 }}>
                            Table backups contain only INSERT statements (data). Schema is NOT included.
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
                                            <TableCell>Table Name</TableCell>
                                            <TableCell align="center">Row Count</TableCell>
                                            <TableCell align="right">Actions</TableCell>
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
                                                    >
                                                        Backup
                                                    </Button>
                                                    <Button
                                                        size="small"
                                                        startIcon={<Upload />}
                                                        onClick={() => handleRestoreTable(table.name)}
                                                        color="warning"
                                                    >
                                                        Restore
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
                <DialogTitle>Restore Table: {restoreDialog.table}</DialogTitle>
                <DialogContent>
                    <Box sx={{ minWidth: 400 }}>
                        <Alert severity="warning" sx={{ mb: 2 }}>
                            This operation will modify the database. Make sure you have a backup!
                        </Alert>

                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={deleteBeforeRestore}
                                    onChange={(e) => setDeleteBeforeRestore(e.target.checked)}
                                />
                            }
                            label="Delete all rows before restoring"
                        />

                        <Box sx={{ mt: 2 }}>
                            <Button
                                variant="outlined"
                                component="label"
                                fullWidth
                            >
                                Select SQL File
                                <input
                                    type="file"
                                    hidden
                                    accept=".sql"
                                    onChange={handleFileSelect}
                                />
                            </Button>
                            {selectedFile && (
                                <Typography variant="body2" sx={{ mt: 1 }}>
                                    Selected: {selectedFile.name}
                                </Typography>
                            )}
                        </Box>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRestoreDialog({ open: false, table: null })}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleRestoreConfirm}
                        variant="contained"
                        color="warning"
                        disabled={!selectedFile}
                    >
                        Restore
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Full Database Restore Dialog */}
            <Dialog open={fullRestoreDialog} onClose={() => setFullRestoreDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Full Database Restore</DialogTitle>
                <DialogContent>
                    <Box sx={{ minWidth: 400 }}>
                        <Alert severity="error" sx={{ mb: 2 }}>
                            <strong>⚠️ DESTRUCTIVE OPERATION!</strong><br />
                            This will replace your entire database with the backup file.
                            All current data will be lost if "Drop existing tables" is checked.
                            Make sure you have a recent backup before proceeding!
                        </Alert>

                        <Alert severity="info" sx={{ mb: 2 }}>
                            The backup file must be a full database backup containing both schema (CREATE TABLE statements) and data (INSERT statements).
                        </Alert>

                        <Alert severity="info" sx={{ mb: 2 }}>
                            Maximum full restore file size: {FULL_RESTORE_MAX_FILE_SIZE_MB} MB.
                        </Alert>

                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={dropTables}
                                    onChange={(e) => setDropTables(e.target.checked)}
                                />
                            }
                            label="Drop existing tables before restore (recommended)"
                        />

                        <Box sx={{ mt: 2 }}>
                            <Button
                                variant="outlined"
                                component="label"
                                fullWidth
                            >
                                Select Full Backup SQL File
                                <input
                                    type="file"
                                    hidden
                                    accept=".sql"
                                    onChange={handleFullRestoreFileSelect}
                                />
                            </Button>
                            {fullRestoreFile && (
                                <Typography variant="body2" sx={{ mt: 1 }}>
                                    Selected: {fullRestoreFile.name}
                                </Typography>
                            )}
                        </Box>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setFullRestoreDialog(false)} disabled={loading}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleFullRestoreConfirm}
                        variant="contained"
                        color="error"
                        disabled={!fullRestoreFile || loading}
                    >
                        {loading ? <CircularProgress size={24} /> : 'Restore Full Database'}
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
                        Reloading application...
                    </Typography>
                </Box>
            </Backdrop>
        </>
    );
};

export default DatabaseBackupCard;
