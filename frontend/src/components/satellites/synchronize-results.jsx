import React, { useEffect, useRef, useState } from 'react';
import {Box} from '@mui/material';
import Grid from '@mui/material/Grid';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import AddedItemsTable from './synchronize-added.jsx';
import ModifiedItemsTable from './synchronize-modified.jsx';
import RemovedItemsTable from './synchronize-removed.jsx';
import { SatelliteInfoDialog } from './satellite-info-page.jsx';
import { fetchSatellite } from './satellite-slice.jsx';
import { useSocket } from '../common/socket.jsx';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import PropTypes from 'prop-types';

const SyncResultsTable = ({
                              hasNewItems=true,
                              hasModifiedItems=true,
                              hasRemovedItems=true,
                              newSatellitesCount=0,
                              newTransmittersCount=0,
                              modifiedSatellitesCount=0,
                              modifiedTransmittersCount=0,
                              removedSatellitesCount=0,
                              removedTransmittersCount=0,
                              syncState
                          }) => {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { t } = useTranslation('satellites');
    const [satelliteInfo, setSatelliteInfo] = useState(null);
    const [loadingNoradId, setLoadingNoradId] = useState(null);
    const latestRequestRef = useRef(0);

    useEffect(() => () => {
        latestRequestRef.current += 1;
    }, []);

    const handleOpenSatellite = async (satellite) => {
        const noradId = Number(satellite?.norad_id);
        if (!socket || !Number.isInteger(noradId) || noradId <= 0) return;

        // A later click or an unmount must not open an earlier request's dialog.
        const requestId = ++latestRequestRef.current;
        setLoadingNoradId(noradId);
        // Show the selected satellite's dialog immediately while full details load.
        setSatelliteInfo({
            norad_id: noradId,
            name: satellite?.name || '',
            position: null,
            transmitters: [],
        });
        try {
            const response = await dispatch(fetchSatellite({ socket, noradId })).unwrap();
            if (latestRequestRef.current !== requestId) return;
            if (Number(response?.details?.norad_id) !== noradId) {
                throw new Error('Satellite details unavailable');
            }
            setSatelliteInfo({
                ...response.details,
                position: response.position || null,
                transmitters: response.transmitters || [],
            });
        } catch (error) {
            if (latestRequestRef.current === requestId) {
                setSatelliteInfo(null);
                toast.error(t('satellite_database.failed_load'));
            }
        } finally {
            if (latestRequestRef.current === requestId) setLoadingNoradId(null);
        }
    };

    const handleCloseSatellite = () => {
        latestRequestRef.current += 1;
        setSatelliteInfo(null);
    };

    //if (!hasNewItems && !hasModifiedItems && !hasRemovedItems) return null;

    return (
        <Box sx={{mt: 2}}>
            <Grid
                container
                spacing={{xs: 1, sm: 1, md: 1}}
                sx={{
                    width: '100%',
                    justifyContent: 'flex-start'
                }}
            >
                <Grid size={{xs: 12, sm: 12, md: 4, lg: 4, xl: 4}}>
                    <AddedItemsTable
                        newSatellitesCount={newSatellitesCount}
                        newTransmittersCount={newTransmittersCount}
                        syncState={syncState}
                        onOpenSatellite={handleOpenSatellite}
                        loadingNoradId={loadingNoradId}
                    />
                </Grid>

                <Grid size={{xs: 12, sm: 12, md: 4, lg: 4, xl: 4}}>
                    <ModifiedItemsTable
                        modifiedSatellitesCount={modifiedSatellitesCount}
                        modifiedTransmittersCount={modifiedTransmittersCount}
                        syncState={syncState}
                        onOpenSatellite={handleOpenSatellite}
                        loadingNoradId={loadingNoradId}
                    />
                </Grid>

                <Grid size={{xs: 12, sm: 12, md: 4, lg: 4, xl: 4}}>
                    <RemovedItemsTable
                        removedSatellitesCount={removedSatellitesCount}
                        removedTransmittersCount={removedTransmittersCount}
                        syncState={syncState}
                    />
                </Grid>
            </Grid>
            <SatelliteInfoDialog
                open={Boolean(satelliteInfo)}
                onClose={handleCloseSatellite}
                satelliteData={satelliteInfo}
                loading={loadingNoradId !== null}
            />
        </Box>
    );
};

SyncResultsTable.propTypes = {
    hasNewItems: PropTypes.bool.isRequired,
    hasModifiedItems: PropTypes.bool.isRequired,
    hasRemovedItems: PropTypes.bool.isRequired,
    newSatellitesCount: PropTypes.number.isRequired,
    newTransmittersCount: PropTypes.number.isRequired,
    modifiedSatellitesCount: PropTypes.number.isRequired,
    modifiedTransmittersCount: PropTypes.number.isRequired,
    removedSatellitesCount: PropTypes.number.isRequired,
    removedTransmittersCount: PropTypes.number.isRequired,
    syncState: PropTypes.object.isRequired,
};

export default SyncResultsTable;
