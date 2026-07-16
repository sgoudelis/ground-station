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

import * as React from 'react';
import Box from '@mui/material/Box';
import {
    Alert,
    AlertTitle,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    FormHelperText,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Stack,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import { DataGrid, gridClasses } from '@mui/x-data-grid';
import { alpha } from '@mui/material/styles';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import { toRowSelectionModel, toSelectedIds } from '../../utils/datagrid-selection.js';
import SelectionActionBar from '../hardware/selection-action-bar.jsx';
import {
    createUser,
    deleteUser,
    fetchUsers,
    resetUserPassword,
    updateUser,
} from '../auth/auth-slice.jsx';

const defaultCreateForm = {
    username: '',
    role: 'operator',
    isActive: true,
    password: '',
    confirmPassword: '',
};

const defaultEditForm = {
    id: '',
    username: '',
    role: 'operator',
    isActive: true,
    password: '',
    confirmPassword: '',
};

function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
}

function UsersForm() {
    const dispatch = useDispatch();
    const authState = useSelector((state) => state.auth);
    const isAdmin = String(authState?.user?.role || '').toLowerCase() === 'admin';
    const users = Array.isArray(authState.users) ? authState.users : [];

    const [selected, setSelected] = React.useState([]);
    const [pageSize, setPageSize] = React.useState(10);
    const [openUserDialog, setOpenUserDialog] = React.useState(false);
    const [openDeleteConfirm, setOpenDeleteConfirm] = React.useState(false);
    const [isEditing, setIsEditing] = React.useState(false);
    const [userForm, setUserForm] = React.useState(defaultCreateForm);
    const [deleteConfirmText, setDeleteConfirmText] = React.useState('');
    const [localError, setLocalError] = React.useState('');

    const rowSelectionModel = React.useMemo(() => toRowSelectionModel(selected), [selected]);
    const selectedUsers = React.useMemo(
        () => users.filter((user) => selected.includes(user.id)),
        [users, selected]
    );
    const requiresDeleteConfirmationText = selected.length > 1;
    const canConfirmDelete = !requiresDeleteConfirmationText || deleteConfirmText.trim() === 'DELETE';
    const isBusy = Boolean(authState.usersLoading || authState.loadingAction);

    React.useEffect(() => {
        if (!isAdmin) return;
        dispatch(fetchUsers());
    }, [dispatch, isAdmin]);

    const columns = [
        { field: 'username', headerName: 'Username', flex: 1, minWidth: 180 },
        { field: 'role', headerName: 'Role', flex: 1, minWidth: 120 },
        {
            field: 'is_active',
            headerName: 'Active',
            flex: 0.6,
            minWidth: 110,
            renderCell: (params) => (params.row?.is_active ? 'Yes' : 'No'),
        },
        {
            field: 'last_login_at',
            headerName: 'Last Login',
            flex: 1.2,
            minWidth: 200,
            renderCell: (params) => formatDateTime(params.row?.last_login_at),
        },
        {
            field: 'created_at',
            headerName: 'Created',
            flex: 1.2,
            minWidth: 200,
            renderCell: (params) => formatDateTime(params.row?.created_at),
        },
    ];

    const resetDialogState = () => {
        setLocalError('');
        setUserForm(defaultCreateForm);
        setIsEditing(false);
    };

    const handleOpenCreateDialog = () => {
        resetDialogState();
        setOpenUserDialog(true);
    };

    const handleOpenEditDialog = () => {
        const selectedUser = users.find((user) => user.id === selected[0]);
        if (!selectedUser) return;

        setLocalError('');
        setIsEditing(true);
        setUserForm({
            ...defaultEditForm,
            id: selectedUser.id,
            username: selectedUser.username,
            role: selectedUser.role,
            isActive: Boolean(selectedUser.is_active),
        });
        setOpenUserDialog(true);
    };

    const validateForm = () => {
        const errors = {};

        if (!String(userForm.username || '').trim()) {
            errors.username = 'Username is required.';
        }
        if (!isEditing) {
            if (String(userForm.password || '').length < 8) {
                errors.password = 'Password must be at least 8 characters long.';
            }
            if (userForm.password !== userForm.confirmPassword) {
                errors.confirmPassword = 'Passwords do not match.';
            }
        } else if (userForm.password || userForm.confirmPassword) {
            if (String(userForm.password || '').length < 8) {
                errors.password = 'Password must be at least 8 characters long.';
            }
            if (userForm.password !== userForm.confirmPassword) {
                errors.confirmPassword = 'Passwords do not match.';
            }
        }

        return errors;
    };

    const handleSaveUser = async () => {
        const errors = validateForm();
        if (Object.keys(errors).length > 0) {
            setLocalError(Object.values(errors)[0]);
            return;
        }

        setLocalError('');

        if (!isEditing) {
            const createAction = await dispatch(
                createUser({
                    username: String(userForm.username || '').trim(),
                    password: userForm.password,
                    role: userForm.role,
                })
            );
            if (!createUser.fulfilled.match(createAction)) {
                setLocalError(createAction.payload || createAction.error?.message || 'Failed to create user.');
                return;
            }
            toast.success('User created successfully.');
            setOpenUserDialog(false);
            resetDialogState();
            return;
        }

        const updateAction = await dispatch(
            updateUser({
                userId: userForm.id,
                role: userForm.role,
                isActive: userForm.isActive,
            })
        );
        if (!updateUser.fulfilled.match(updateAction)) {
            setLocalError(updateAction.payload || updateAction.error?.message || 'Failed to update user.');
            return;
        }

        // Password reset is intentionally a second operation so role/active updates can persist
        // even if the reset step fails (matching how other settings flows handle partial updates).
        if (userForm.password) {
            const resetAction = await dispatch(
                resetUserPassword({
                    userId: userForm.id,
                    password: userForm.password,
                })
            );
            if (!resetUserPassword.fulfilled.match(resetAction)) {
                setLocalError(
                    resetAction.payload || resetAction.error?.message || 'Failed to reset password.'
                );
                return;
            }
        }

        toast.success('User updated successfully.');
        setOpenUserDialog(false);
        resetDialogState();
    };

    const handleDeleteUsers = async () => {
        let hadError = false;

        for (const userId of selected) {
            const action = await dispatch(deleteUser({ userId }));
            if (!deleteUser.fulfilled.match(action)) {
                hadError = true;
                toast.error(action.payload || action.error?.message || 'Failed to delete user.');
            }
        }

        if (!hadError) {
            toast.success(selected.length === 1 ? 'User deleted.' : 'Users deleted.');
        }
        setSelected([]);
        setDeleteConfirmText('');
        setOpenDeleteConfirm(false);
    };

    if (!isAdmin) {
        return (
            <Paper elevation={3} sx={{ px: 2, pb: 2, pt: 1, marginTop: 0, borderRadius: 0 }}>
                <Alert severity="warning">Only admins can manage users.</Alert>
            </Paper>
        );
    }

    return (
        <Paper elevation={3} sx={{ px: 2, pb: 2, pt: 1, marginTop: 0, borderRadius: 0 }}>
            <Box component="form">
                <Box sx={{ width: '100%' }}>
                    <DataGrid
                        loading={isBusy}
                        rows={users}
                        columns={columns}
                        checkboxSelection
                        disableRowSelectionExcludeModel
                        rowSelectionModel={rowSelectionModel}
                        onRowSelectionModelChange={(nextSelection) => setSelected(toSelectedIds(nextSelection))}
                        initialState={{
                            pagination: { paginationModel: { pageSize: 5 } },
                            sorting: {
                                sortModel: [{ field: 'username', sort: 'asc' }],
                            },
                        }}
                        pageSize={pageSize}
                        pageSizeOptions={[5, 10, 25, { value: -1, label: 'All' }]}
                        onPageSizeChange={(newPageSize) => setPageSize(newPageSize)}
                        rowsPerPageOptions={[5, 10, 25]}
                        getRowId={(row) => row.id}
                        localeText={{ noRowsLabel: 'No users found' }}
                        sx={{
                            border: 0,
                            marginTop: 1,
                            [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                                outline: 'none',
                            },
                            [`& .${gridClasses.columnHeader}:focus, & .${gridClasses.columnHeader}:focus-within`]: {
                                outline: 'none',
                            },
                            '& .MuiDataGrid-columnHeaders': {
                                backgroundColor: (theme) =>
                                    alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
                                borderBottom: (theme) => `2px solid ${alpha(theme.palette.primary.main, 0.45)}`,
                            },
                            '& .MuiDataGrid-columnHeader': {
                                backgroundColor: 'transparent',
                            },
                            '& .MuiDataGrid-columnHeaderTitle': {
                                fontSize: '0.8125rem',
                                fontWeight: 700,
                                letterSpacing: '0.02em',
                            },
                            '& .MuiDataGrid-overlay': {
                                fontSize: '0.875rem',
                                fontStyle: 'italic',
                                color: 'text.secondary',
                            },
                        }}
                    />

                    <SelectionActionBar
                        selectedCount={selected.length}
                        onClearSelection={() => setSelected([])}
                        primaryActions={
                            <>
                                <Button variant="contained" onClick={handleOpenCreateDialog} disabled={isBusy}>
                                    Add
                                </Button>
                                <Button
                                    variant="contained"
                                    onClick={handleOpenEditDialog}
                                    disabled={selected.length !== 1 || isBusy}
                                >
                                    Edit
                                </Button>
                                <Button
                                    variant="contained"
                                    color="error"
                                    onClick={() => {
                                        setDeleteConfirmText('');
                                        setOpenDeleteConfirm(true);
                                    }}
                                    disabled={selected.length < 1 || isBusy}
                                >
                                    Delete
                                </Button>
                            </>
                        }
                    />
                </Box>
            </Box>
            <Alert severity="info" sx={{ mt: 2 }}>
                <AlertTitle>User Management</AlertTitle>
                Manage admin and operator accounts for this station.
            </Alert>

            <Dialog
                open={openUserDialog}
                onClose={() => {
                    setOpenUserDialog(false);
                    resetDialogState();
                }}
                maxWidth="sm"
                fullWidth
                PaperProps={{
                    sx: {
                        bgcolor: 'background.paper',
                        borderRadius: 2,
                    },
                }}
            >
                <DialogTitle sx={{ pb: 1.5 }}>{isEditing ? 'Edit User' : 'Add User'}</DialogTitle>
                <DialogContent
                    sx={{
                        px: 3,
                        pt: 3,
                        pb: 2,
                        // MUI applies `.MuiDialogTitle-root + .MuiDialogContent-root { padding-top: 0 }`.
                        // Override that specific selector so the add/edit form has visible top spacing.
                        '.MuiDialogTitle-root + &': {
                            pt: 3,
                        },
                    }}
                >
                    <Stack spacing={2}>
                        {(localError || authState.error) && (
                            <Alert severity="error">{localError || authState.error}</Alert>
                        )}
                        <TextField
                            label="Username"
                            value={userForm.username}
                            onChange={(event) =>
                                setUserForm((current) => ({
                                    ...current,
                                    username: event.target.value,
                                }))
                            }
                            disabled={isEditing}
                            fullWidth
                            required
                        />
                        <FormControl fullWidth size="small">
                            <InputLabel id="user-role-label">Role</InputLabel>
                            <Select
                                labelId="user-role-label"
                                label="Role"
                                value={userForm.role}
                                onChange={(event) =>
                                    setUserForm((current) => ({
                                        ...current,
                                        role: event.target.value,
                                    }))
                                }
                            >
                                <MenuItem value="admin">admin</MenuItem>
                                <MenuItem value="operator">operator</MenuItem>
                            </Select>
                        </FormControl>

                        {isEditing && (
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={Boolean(userForm.isActive)}
                                        onChange={(_event, checked) =>
                                            setUserForm((current) => ({
                                                ...current,
                                                isActive: checked,
                                            }))
                                        }
                                    />
                                }
                                label="Active"
                            />
                        )}

                        <TextField
                            label={isEditing ? 'New Password (Optional)' : 'Password'}
                            type="password"
                            value={userForm.password}
                            onChange={(event) =>
                                setUserForm((current) => ({
                                    ...current,
                                    password: event.target.value,
                                }))
                            }
                            fullWidth
                            required={!isEditing}
                        />
                        <TextField
                            label={isEditing ? 'Confirm New Password' : 'Confirm Password'}
                            type="password"
                            value={userForm.confirmPassword}
                            onChange={(event) =>
                                setUserForm((current) => ({
                                    ...current,
                                    confirmPassword: event.target.value,
                                }))
                            }
                            fullWidth
                            required={!isEditing}
                        />
                        <FormHelperText>
                            {isEditing
                                ? 'Leave password fields empty to keep current password.'
                                : 'Password must be at least 8 characters long.'}
                        </FormHelperText>
                    </Stack>
                </DialogContent>
                <DialogActions
                    sx={{
                        px: 3,
                        py: 2,
                        borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                    }}
                >
                    <Button
                        variant="outlined"
                        onClick={() => {
                            setOpenUserDialog(false);
                            resetDialogState();
                        }}
                    >
                        Cancel
                    </Button>
                    <Button variant="contained" onClick={handleSaveUser} disabled={isBusy}>
                        Save
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={openDeleteConfirm}
                onClose={() => {
                    setDeleteConfirmText('');
                    setOpenDeleteConfirm(false);
                }}
                maxWidth="sm"
                fullWidth
                PaperProps={{
                    sx: {
                        bgcolor: 'background.paper',
                        borderRadius: 2,
                    },
                }}
            >
                <DialogTitle
                    sx={{
                        bgcolor: 'error.main',
                        color: 'error.contrastText',
                        fontSize: '1.125rem',
                        fontWeight: 600,
                        py: 2,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                    }}
                >
                    <Box
                        component="span"
                        sx={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            bgcolor: 'error.contrastText',
                            color: 'error.main',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold',
                            fontSize: '1rem',
                        }}
                    >
                        !
                    </Box>
                    Confirm Deletion
                </DialogTitle>
                <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                    <Typography variant="body1" sx={{ mt: 2, mb: 2, color: 'text.primary' }}>
                        Delete the selected user account{selected.length > 1 ? 's' : ''}?
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                        {selected.length === 1
                            ? '1 user selected'
                            : `${selected.length} users selected`}
                    </Typography>

                    {requiresDeleteConfirmationText && (
                        <TextField
                            fullWidth
                            size="small"
                            label="Type DELETE to confirm"
                            value={deleteConfirmText}
                            onChange={(event) => setDeleteConfirmText(event.target.value)}
                            sx={{ mb: 2 }}
                        />
                    )}

                    <Box
                        sx={{
                            maxHeight: 300,
                            overflowY: 'auto',
                            bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50'),
                            borderRadius: 1,
                            border: (theme) => `1px solid ${theme.palette.divider}`,
                        }}
                    >
                        {selectedUsers.map((user, index) => (
                            <Box
                                key={user.id}
                                sx={{
                                    p: 2,
                                    borderBottom:
                                        index < selectedUsers.length - 1
                                            ? (theme) => `1px solid ${theme.palette.divider}`
                                            : 'none',
                                }}
                            >
                                <Typography
                                    variant="subtitle2"
                                    sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}
                                >
                                    {user.username}
                                </Typography>
                                <Box
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: 'auto 1fr',
                                        gap: 1,
                                        columnGap: 2,
                                    }}
                                >
                                    <Typography
                                        variant="body2"
                                        sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}
                                    >
                                        Role:
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{ fontSize: '0.813rem', color: 'text.primary' }}
                                    >
                                        {user.role}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}
                                    >
                                        Active:
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{ fontSize: '0.813rem', color: 'text.primary' }}
                                    >
                                        {user.is_active ? 'Yes' : 'No'}
                                    </Typography>
                                </Box>
                            </Box>
                        ))}
                    </Box>
                </DialogContent>
                <DialogActions
                    sx={{
                        bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50'),
                        borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                        px: 3,
                        py: 2,
                        gap: 1.5,
                    }}
                >
                    <Button
                        onClick={() => setOpenDeleteConfirm(false)}
                        variant="outlined"
                        color="inherit"
                        sx={{ minWidth: 100, textTransform: 'none', fontWeight: 500 }}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={handleDeleteUsers}
                        disabled={!canConfirmDelete || isBusy}
                        sx={{ minWidth: 100, textTransform: 'none', fontWeight: 600 }}
                    >
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
}

export default UsersForm;
