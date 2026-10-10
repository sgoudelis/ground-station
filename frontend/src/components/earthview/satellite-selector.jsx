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


import {
    Box,
    FormControl,
    InputLabel,
    ListSubheader,
    MenuItem,
    Select,
    Typography,
} from "@mui/material";
import { useTheme, styled } from '@mui/material/styles';
import React, {useEffect, useState} from "react";
import Grid from "@mui/material/Grid";
import {getClassNamesBasedOnGridEditing, islandTitleBarSx, TitleBar} from "../common/common.jsx";
import {useSocket} from "../common/socket.jsx";
import { toast } from '../../utils/toast-with-timestamp.jsx';
import {useLocalStorageState} from "@toolpad/core";
import {useDispatch, useSelector} from "react-redux";
import {
    fetchSatelliteGroups,
    setSatGroups,
    setFormGroupSelectError,
    setSelectedSatGroupId,
    setSelectedSatellites,
    fetchSatellitesByGroupId,
} from "./earthview-slice.jsx";
import { useTranslation } from 'react-i18next';

const SATELLITE_NUMBER_LIMIT = 200;


const EarthViewSatelliteGroupSelector = React.memo(function EarthViewSatelliteGroupSelector() {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('earthview');
    // const {
    //     satelliteGroupId,
    //     satGroups,
    //     formGroupSelectError,
    //     selectedSatGroupId,
    //     gridEditable,
    //     passesLoading,
    // } = useSelector(state => state.earthViewTrack);

    // Use separate selectors for better performance
    const satelliteGroupId = useSelector(state => state.earthViewTrack.satelliteGroupId);
    const satGroups = useSelector(state => state.earthViewTrack.satGroups);
    const formGroupSelectError = useSelector(state => state.earthViewTrack.formGroupSelectError);
    const selectedSatGroupId = useSelector(state => state.earthViewTrack.selectedSatGroupId);
    const gridEditable = useSelector(state => state.earthViewTrack.gridEditable);
    const passesLoading = useSelector(state => state.earthViewTrack.passesLoading);

    const ThemedSettingsDiv = styled('div')(({theme}) => ({
        backgroundColor: theme.palette.background.paper,
        fontsize: '0.9rem !important',
    }));

    useEffect(() => {
        dispatch(fetchSatelliteGroups({socket}))
            .unwrap()
            .then((data) => {
                if (data && selectedSatGroupId !== "" && selectedSatGroupId !== "none") {
                    dispatch(fetchSatellitesByGroupId({socket: socket, satGroupId: selectedSatGroupId}));
                }
            })
            .catch((err) => {
                toast.error(t('satellite_selector.failed_load_groups') + ": " + err.message)
            });

        return () => {

        };
    }, []);

    function handleOnGroupChange(event) {
        // Let's get a list of satellites for the selected group
        const satGroupId = event.target.value;
        if (!satGroupId || satGroupId === 'none') {
            return;
        }
        dispatch(setSelectedSatGroupId(satGroupId));
        dispatch(fetchSatellitesByGroupId({socket, satGroupId}));
    }

    return (
        <ThemedSettingsDiv>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
                sx={islandTitleBarSx}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                    <Box sx={{display: 'flex', alignItems: 'center'}}>
                        <Typography variant="subtitle2" sx={{fontWeight: 'bold'}}>
                            {t('satellite_selector.title')}
                        </Typography>
                    </Box>
                </Box>
            </TitleBar>
            <Grid container spacing={{ xs: 1, md: 1 }} columns={{ xs: 12, sm: 12, md: 12 }}>
                <Grid size={{ xs: 12, sm: 12, md: 12  }} style={{padding: '0.5rem 0.5rem 0rem 0.5rem'}}>
                    <FormControl sx={{ minWidth: 200, marginTop: 1, marginBottom: 1 }} disabled={passesLoading}
                                 fullWidth variant={"filled"} size={"small"}>
                        <InputLabel htmlFor="grouped-select">{t('satellite_selector.group_label')}</InputLabel>
                        <Select
                            disabled={passesLoading}
                            error={formGroupSelectError}
                            value={satGroups.length ? selectedSatGroupId: ""}
                            id="grouped-select"
                            label={t('satellite_selector.grouping', { defaultValue: 'Grouping' })}
                            variant={"filled"}
                            size={"small"}
                            onChange={handleOnGroupChange}
                        >
                            <ListSubheader>{t('satellite_selector.user_groups')}</ListSubheader>
                            {satGroups.filter(group => group.type === "user").length === 0 ? (
                                <MenuItem disabled value="">
                                    {t('satellite_selector.none_defined')}
                                </MenuItem>
                            ) : (
                                satGroups.map((group, index) => {
                                    if (group.type === "user") {
                                        return <MenuItem disabled={group.satellite_ids.length>SATELLITE_NUMBER_LIMIT} value={group.id} key={index}>{group.name} ({group.satellite_ids.length})</MenuItem>;
                                    }
                                })
                            )}
                            <ListSubheader>{t('satellite_selector.tle_groups')}</ListSubheader>
                            {satGroups.filter(group => group.type === "system").length === 0 ? (
                                <MenuItem disabled value="">
                                    {t('satellite_selector.none_defined')}
                                </MenuItem>
                            ) : (
                                satGroups.map((group, index) => {
                                    if (group.type === "system") {
                                        return <MenuItem disabled={group.satellite_ids.length>SATELLITE_NUMBER_LIMIT} value={group.id} key={index}>{group.name} ({group.satellite_ids.length})</MenuItem>;
                                    }
                                })
                            )}
                        </Select>
                    </FormControl>
                </Grid>
            </Grid>
        </ThemedSettingsDiv>
    );
});

export default EarthViewSatelliteGroupSelector;
