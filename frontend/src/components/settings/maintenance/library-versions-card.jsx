/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 */

import React, { useState, useEffect } from 'react';
import { Typography, Divider, Button, Alert, CircularProgress, Box, Tabs, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useSocket } from "../../common/socket.jsx";
import { useDispatch, useSelector } from 'react-redux';
import { fetchLibraryVersions, fetchFrontendLibraryVersions } from '../library-versions-slice.jsx';
import { useTranslation } from 'react-i18next';

const LibraryVersionsCard = () => {
    const { t } = useTranslation('settings');
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const libraryVersions = useSelector((state) => state.libraryVersions);
    const [libraryVersionsTab, setLibraryVersionsTab] = useState(0);

    // Load library versions on component mount
    useEffect(() => {
        if (socket && socket.connected) {
            if (Object.keys(libraryVersions.backend.categories).length === 0 && !libraryVersions.backend.loading) {
                dispatch(fetchLibraryVersions({ socket }));
            }
            if (Object.keys(libraryVersions.frontend.categories).length === 0 && !libraryVersions.frontend.loading) {
                dispatch(fetchFrontendLibraryVersions({ socket }));
            }
        }
    }, [socket, dispatch, libraryVersions.backend.categories, libraryVersions.backend.loading, libraryVersions.frontend.categories, libraryVersions.frontend.loading]);

    const handleRefreshLibraryVersions = () => {
        if (socket && socket.connected) {
            dispatch(fetchLibraryVersions({ socket }));
        }
    };

    const handleRefreshFrontendLibraryVersions = () => {
        if (socket && socket.connected) {
            dispatch(fetchFrontendLibraryVersions({ socket }));
        }
    };

    return (
        <>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">
                    {t('library_versions_card.library_versions', { defaultValue: 'Library Versions' })}
                </Typography>
                <Button
                    variant="outlined"
                    size="small"
                    startIcon={
                        (libraryVersionsTab === 0 ? libraryVersions.backend.loading : libraryVersions.frontend.loading)
                        ? <CircularProgress size={16} />
                        : <RefreshIcon />
                    }
                    onClick={libraryVersionsTab === 0 ? handleRefreshLibraryVersions : handleRefreshFrontendLibraryVersions}
                    disabled={libraryVersionsTab === 0 ? libraryVersions.backend.loading : libraryVersions.frontend.loading}
                >
                    {t('library_versions_card.refresh', { defaultValue: 'Refresh' })}
                </Button>
            </Box>
            <Divider sx={{ mb: 2 }} />

            <Tabs value={libraryVersionsTab} onChange={(e, newValue) => setLibraryVersionsTab(newValue)} sx={{ mb: 2 }}>
                <Tab label={t('library_versions_card.backend', { defaultValue: 'Backend' })} />
                <Tab label={t('library_versions_card.frontend', { defaultValue: 'Frontend' })} />
            </Tabs>

            {/* Backend Tab */}
            {libraryVersionsTab === 0 && (
                <>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {t('library_versions_card.versions_of_installed_backend_libraries_and_dependencies', { defaultValue: 'Versions of installed backend libraries and dependencies' })}
                    </Typography>

                    {libraryVersions.backend.error && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            {libraryVersions.backend.error}
                        </Alert>
                    )}

                    {libraryVersions.backend.loading && !Object.keys(libraryVersions.backend.categories).length ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                            <CircularProgress />
                        </Box>
                    ) : (
                        <>
                            {Object.keys(libraryVersions.backend.categories).length > 0 ? (
                                <>
                                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                        {t('library_versions_card.total_libraries', { defaultValue: 'Total libraries:' })} <strong>{libraryVersions.backend.totalCount}</strong>
                                    </Typography>
                                    <TableContainer>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell><strong>{t('library_versions_card.category', { defaultValue: 'Category' })}</strong></TableCell>
                                                    <TableCell><strong>{t('library_versions_card.library', { defaultValue: 'Library' })}</strong></TableCell>
                                                    <TableCell><strong>{t('library_versions_card.description', { defaultValue: 'Description' })}</strong></TableCell>
                                                    <TableCell><strong>{t('library_versions_card.version', { defaultValue: 'Version' })}</strong></TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {Object.entries(libraryVersions.backend.categories).map(([category, libraries]) => (
                                                    libraries.map((lib, index) => (
                                                        <TableRow key={lib.key} hover>
                                                            <TableCell sx={{ textTransform: 'capitalize' }}>
                                                                {index === 0 ? category : ''}
                                                            </TableCell>
                                                            <TableCell>
                                                                {lib.name}
                                                            </TableCell>
                                                            <TableCell>
                                                                <Typography variant="body2" color="text.secondary">
                                                                    {lib.description}
                                                                </Typography>
                                                            </TableCell>
                                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                                                                {lib.version}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                </>
                            ) : (
                                <Alert severity="info">
                                    {t('library_versions_card.no_backend_library_version_information_available', { defaultValue: 'No backend library version information available' })}
                                </Alert>
                            )}
                        </>
                    )}
                </>
            )}

            {/* Frontend Tab */}
            {libraryVersionsTab === 1 && (
                <>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {t('library_versions_card.versions_of_frontend_packages_from_package_json', { defaultValue: 'Versions of frontend packages from package.json' })}
                    </Typography>

                    {libraryVersions.frontend.error && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            {libraryVersions.frontend.error}
                        </Alert>
                    )}

                    {libraryVersions.frontend.loading && !Object.keys(libraryVersions.frontend.categories).length ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                            <CircularProgress />
                        </Box>
                    ) : (
                        <>
                            {Object.keys(libraryVersions.frontend.categories).length > 0 ? (
                                <>
                                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                        {t('library_versions_card.total_packages', { defaultValue: 'Total packages:' })} <strong>{libraryVersions.frontend.totalCount}</strong>
                                    </Typography>
                                    <TableContainer>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell><strong>{t('library_versions_card.category', { defaultValue: 'Category' })}</strong></TableCell>
                                                    <TableCell><strong>{t('library_versions_card.package', { defaultValue: 'Package' })}</strong></TableCell>
                                                    <TableCell><strong>{t('library_versions_card.description', { defaultValue: 'Description' })}</strong></TableCell>
                                                    <TableCell><strong>{t('library_versions_card.version', { defaultValue: 'Version' })}</strong></TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {Object.entries(libraryVersions.frontend.categories).map(([category, libraries]) => (
                                                    libraries.map((lib, index) => (
                                                        <TableRow key={lib.key} hover>
                                                            <TableCell sx={{ textTransform: 'capitalize' }}>
                                                                {index === 0 ? category : ''}
                                                            </TableCell>
                                                            <TableCell>
                                                                {lib.name}
                                                            </TableCell>
                                                            <TableCell>
                                                                <Typography variant="body2" color="text.secondary">
                                                                    {lib.description}
                                                                </Typography>
                                                            </TableCell>
                                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                                                                {lib.version}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                </>
                            ) : (
                                <Alert severity="info">
                                    {t('library_versions_card.no_frontend_library_version_information_available', { defaultValue: 'No frontend library version information available' })}
                                </Alert>
                            )}
                        </>
                    )}
                </>
            )}
        </>
    );
};

export default LibraryVersionsCard;
