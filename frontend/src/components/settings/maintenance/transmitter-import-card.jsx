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

import React, { useState } from 'react';
import {
    Typography,
    Button,
    Box,
    Alert,
    Divider,
    CircularProgress
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { useSocket } from '../../common/socket.jsx';
import { toast } from '../../../utils/toast-with-timestamp.jsx';
import { useTranslation } from 'react-i18next';

const TransmitterImportCard = () => {
    const { t } = useTranslation('settings');
    const { socket } = useSocket();
    const [activeSource, setActiveSource] = useState(null);
    const [results, setResults] = useState({});

    const handleImport = async (source) => {
        if (!socket) return;

        setActiveSource(source);
        try {
            const response = await socket.emitWithAck('api.call', {
                cmd: `transmitter-import.${source}`,
                data: { source }
            });
            if (response.success) {
                setResults((prev) => ({ ...prev, [source]: response }));
                toast.success(
                    `Import complete (${source}): ${response.upserted} upserted, ${response.skipped_missing_sat} missing satellites`
                );
            } else {
                toast.error(`Import failed (${source}): ${response.error}`);
                setResults((prev) => ({ ...prev, [source]: response }));
            }
        } catch (error) {
            toast.error(`Import error (${source}): ${error.message}`);
            setResults((prev) => ({ ...prev, [source]: { success: false, error: error.message } }));
        } finally {
            setActiveSource(null);
        }
    };

    const renderResult = (source) => {
        const result = results[source];
        if (!result) return null;

        if (!result.success) {
            return (
                <Alert severity="error" sx={{ mt: 2 }}>
                    {result.error || 'Import failed.'}
                </Alert>
            );
        }

        const details = [
            `${result.upserted} upserted`,
            `${result.skipped_missing_sat} missing satellites`,
            `${result.skipped_no_frequency} without frequency`
        ];
        if (typeof result.skipped_invalid_yaml === 'number') {
            details.push(`${result.skipped_invalid_yaml} invalid YAML`);
        }

        return (
            <Alert severity="success" sx={{ mt: 2 }}>
                {details.join(', ')}
            </Alert>
        );
    };

    return (
        <>
            <Typography variant="h6" gutterBottom>
                {t('transmitter_import_card.transmitter_imports', { defaultValue: 'Transmitter Imports' })}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('transmitter_import_card.import_transmitters_from_trusted_sources_existing_transm', { defaultValue: 'Import transmitters from trusted sources. Existing transmitters are upserted by id.' })}
            </Typography>

            <Alert severity="info" sx={{ mb: 2 }}>
                {t('transmitter_import_card.satdump_uses_the_live_satellite_list_page_gr_satellites_', { defaultValue: 'SatDump uses the live satellite list page. gr-satellites reads local SatYAML data.' })}
            </Alert>

            <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                    {t('transmitter_import_card.satdump_satdump_org', { defaultValue: 'SatDump (satdump.org)' })}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('transmitter_import_card.scrape_the_satdump_satellite_list_page_and_upsert_transm', { defaultValue: 'Scrape the SatDump Satellite-List page and upsert transmitters into the database.' })}
                </Typography>
                <Button
                    variant="contained"
                    startIcon={
                        activeSource === 'satdump' ? (
                            <CircularProgress size={18} color="inherit" />
                        ) : (
                            <DownloadIcon />
                        )
                    }
                    onClick={() => handleImport('satdump')}
                    disabled={activeSource !== null}
                >
                    {t('transmitter_import_card.import_satdump_transmitters', { defaultValue: 'Import SatDump Transmitters' })}
                </Button>
                {renderResult('satdump')}
            </Box>

            <Divider sx={{ my: 3 }} />

            <Box>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                    gr-satellites
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('transmitter_import_card.parse_satyaml_files_and_upsert_transmitters_into_the_dat', { defaultValue: 'Parse SatYAML files and upsert transmitters into the database.' })}
                </Typography>
                <Button
                    variant="contained"
                    startIcon={
                        activeSource === 'gr-satellites' ? (
                            <CircularProgress size={18} color="inherit" />
                        ) : (
                            <DownloadIcon />
                        )
                    }
                    onClick={() => handleImport('gr-satellites')}
                    disabled={activeSource !== null}
                >
                    {t('transmitter_import_card.import_gr_satellites_transmitters', { defaultValue: 'Import gr-satellites Transmitters' })}
                </Button>
                {renderResult('gr-satellites')}
            </Box>
        </>
    );
};

export default TransmitterImportCard;
