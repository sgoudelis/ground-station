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
 */

import React, {forwardRef, useImperativeHandle, useRef} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {TitleBar, getClassNamesBasedOnGridEditing} from '../common/common.jsx';
import {setExpandedPanels} from './waterfall-slice.jsx';
import FrequencyControlPanel from './frequency-panel.jsx';
import SDRPanel from './sdr-panel.jsx';
import FFTPanel from './fft-panel.jsx';
import VFOPanel from './vfo-panel.jsx';

const WaterfallSettings = forwardRef((props, ref) => {
    const dispatch = useDispatch();
    const {expandedPanels, gridEditable} = useSelector((state) => ({
        expandedPanels: state.waterfall.expandedPanels,
        gridEditable: state.waterfall.gridEditable,
    }));

    const sdrRef = useRef(null);

    const handleAccordionChange = (panel) => (event, isExpanded) => {
        const updateExpandedPanels = (expandedPanels) => {
            if (isExpanded) {
                return expandedPanels.includes(panel)
                    ? expandedPanels
                    : [...expandedPanels, panel];
            }
            return expandedPanels.filter(p => p !== panel);
        };
        dispatch(setExpandedPanels(updateExpandedPanels(expandedPanels)));
    };

    useImperativeHandle(ref, () => ({
        sendSDRConfigToBackend: (updates) => sdrRef.current?.sendSDRConfigToBackend(updates),
        handleSDRChange: (...args) => sdrRef.current?.handleSDRChange(...args)
    }));

    return (
        <>
            <TitleBar className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}>Waterfall settings</TitleBar>
            <div style={{overflowY: 'auto', height: '100%', paddingBottom: '29px'}}>
                <FrequencyControlPanel
                    expanded={expandedPanels.includes('freqControl')}
                    onChange={handleAccordionChange('freqControl')}
                    sendSDRConfigToBackend={(updates) => sdrRef.current?.sendSDRConfigToBackend(updates)}
                />
                <SDRPanel
                    ref={sdrRef}
                    expanded={expandedPanels.includes('sdr')}
                    onChange={handleAccordionChange('sdr')}
                />
                <FFTPanel
                    expanded={expandedPanels.includes('fft')}
                    onChange={handleAccordionChange('fft')}
                    sendSDRConfigToBackend={(updates) => sdrRef.current?.sendSDRConfigToBackend(updates)}
                />
                <VFOPanel
                    expanded={expandedPanels.includes('vfo')}
                    onChange={handleAccordionChange('vfo')}
                />
            </div>
        </>
    );
});

export default WaterfallSettings;
