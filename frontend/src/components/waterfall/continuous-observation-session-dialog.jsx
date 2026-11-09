// Copyright (c) 2026 Efstratios Goudelis
// SPDX-License-Identifier: GPL-3.0-or-later

import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { useSocket } from '../common/socket.jsx';
import ContinuousObservationForm from '../scheduler/continuous-observation-form.jsx';
import { saveContinuousObservation } from '../scheduler/continuous-observations-slice.js';
import { toast } from '../../utils/toast-with-timestamp.jsx';

export default function ContinuousObservationSessionDialog({ observation, onClose }) {
    const { t } = useTranslation('waterfall');
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const store = useStore();
    const epoch = useSelector((state) => state.continuousObservations.epoch);
    const initialEpoch = useRef(epoch);
    const mounted = useRef(true);
    const writing = useRef(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    useEffect(() => {
        // A logout ends this draft and must not let late acknowledgements affect a new session.
        if (epoch !== initialEpoch.current) onClose();
    }, [epoch, onClose]);

    const save = async (draft) => {
        if (writing.current) return;
        writing.current = true;
        setSaving(true);
        setError(null);
        const isCurrent = () => mounted.current && store.getState().continuousObservations.epoch === initialEpoch.current;
        try {
            // Creating a definition never detaches or reconfigures the live waterfall session.
            await dispatch(saveContinuousObservation({ socket, observation: draft, create: true })).unwrap();
            if (isCurrent()) {
                toast.success(t('sdr.continuous_observation_saved'));
                onClose();
            }
        } catch (failure) {
            if (isCurrent()) setError(failure.message || t('common:continuous_observations.request_failed'));
        } finally {
            writing.current = false;
            if (isCurrent()) setSaving(false);
        }
    };

    return <ContinuousObservationForm observation={observation} saving={saving} saveError={error}
        connected={Boolean(socket && socket.connected !== false)} onSave={save} onClose={onClose} />;
}
