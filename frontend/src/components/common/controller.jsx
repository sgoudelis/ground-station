import React, {useState, useEffect} from 'react';
import {Box, Tab, Tabs} from '@mui/material';
import {styled} from "@mui/material/styles";
import RotatorControl from '../dashboard/rotator-control.jsx'
import RigControl from '../dashboard/rig-control.jsx'
import {getClassNamesBasedOnGridEditing, TitleBar} from "./common.jsx";
import {useSelector} from "react-redux";
import { useTranslation } from 'react-i18next';


const LedIcon = ({color = '#666666'}) => (
    <Box
        component="span"
        sx={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            backgroundColor: color,
            marginRight: 1,
            boxShadow: `0 0 5px ${color}`,
        }}
    />
);


function TabPanel({children, value, index}) {
    return (
        <div hidden={value !== index} role="tabpanel">
            {value === index && <Box sx={{p: 0}}>{children}</Box>}
        </div>
    );
}

export const HardwareTabs = styled(Tabs)({
    '& .MuiTabs-root': {
        overflow: 'hidden'
    },
    '& .MuiTabs-indicator': {
        position: 'absolute',
        top: 0,
        height: 3,
        backgroundColor: 'primary.main',
        '&.Mui-disabled': {
            display: 'none',
        },
        display: 'none',
    },
    '& .MuiTab-root': {
        textTransform: 'uppercase',
        fontSize: '0.9rem',
        fontWeight: 500,
        minHeight: 48,
        backgroundColor: '#171717',
        borderBottom: '1px solid #494949',
        '&:hover': {
            backgroundColor: 'action.hover',
        },
    },
    '& .Mui-selected' : {
        backgroundColor: '#1e1e1e',
        borderBottom: 'none',
    },
    '& .MuiButtonBase-root' : {
        //minHeight: 38,
        //padding: 0,
    }
});


export default function ControllerTabs({activeController}) {
    const { t } = useTranslation('common');
    const [activeTab, setActiveTab] = useState(0);
    const {
        gridEditable: isTargetGridEditable,
        rotatorData,
        rigData,
    } = useSelector(state => state.targetSatTrack);

    const {
        gridEditable: isWaterfallGridEditable,
    } = useSelector(state => state.waterfall);

    const handleTabChange = (event, newValue) => {
        setActiveTab(newValue);
    };

    useEffect(() => {
        if (activeController === 'rotator') {
            setActiveTab(0);
        } else if (activeController === 'rig') {
            setActiveTab(1);
        } else {
            setActiveTab(0);
        }

    }, [activeController]);

    return (
        <>
            {/*<TitleBar*/}
            {/*    className={getClassNamesBasedOnGridEditing(isTargetGridEditable || isWaterfallGridEditable, ["window-title-bar"])}>Hardware*/}
            {/*    control</TitleBar>*/}
            <Box sx={{
                width: '100%',
                bgcolor: 'background.paper.main',
            }}>
                <Box sx={{

                }}>
                    <HardwareTabs
                        value={activeTab}
                        onChange={handleTabChange}
                        variant="fullWidth"
                        textColor="primary"
                        indicatorColor="primary"
                    >
                        <Tab icon={<LedIcon color={rotatorData?.connected ? "#00ff00" : "#ff0000"}/>}
                             iconPosition="start" label={t('controller.rotator', { defaultValue: 'Rotator' })}
                             sx={{
                                 borderRight: '1px solid #494949',
                             }}/>
                        <Tab icon={<LedIcon color={rigData?.connected ? "#00ff00" : "#ff0000"}/>}
                             iconPosition="start" label={t('controller.rig', { defaultValue: 'Rig' })} />
                    </HardwareTabs>
                </Box>
                <TabPanel value={activeTab} index={0}>
                    <RotatorControl/>
                </TabPanel>
                <TabPanel value={activeTab} index={1}>
                    <RigControl />
                </TabPanel>
            </Box>
        </>
    );
}