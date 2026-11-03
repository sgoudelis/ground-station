import React, { useState } from 'react';
import { Box, FormControlLabel, Switch, Tooltip, Typography } from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { useSocket } from '../common/socket.jsx';
import { setReceivingSession } from './waterfall-slice.jsx';
import { toast } from '../../utils/toast-with-timestamp.jsx';

export default function BackgroundStreamControl() {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { t } = useTranslation('waterfall');
    const { isStreaming, selectedSDRId, joinedSdrId, backgroundStreaming } = useSelector((state) => state.waterfall);
    const [busy, setBusy] = useState(false);

    const toggleBackground = async (_event, enabled) => {
        if (!socket?.connected || busy) return;
        setBusy(true);
        try {
            const response = await socket.timeout(10000).emitWithAck('api.call', {
                cmd: 'sdr.set-background', data: { selectedSDRId, enabled },
            });
            if (!response?.success) throw new Error(response?.error || 'Could not change background receiving');
            dispatch(setReceivingSession(response.data));
        } catch (error) {
            toast.error(error.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', mt: 1, ml: 1.5 }}>
            <Tooltip describeChild title={t('background.description', {
                defaultValue: 'Keep VFOs, decoders, and recordings running after pressing Stop or closing this tab. Unattended VFOs stay at their last frequency. The next user to join takes control. Uncheck this before pressing Stop to end the observation.',
            })}>
                <FormControlLabel
                    sx={{ mr: 0 }}
                    control={<Switch size="small" checked={Boolean(backgroundStreaming)}
                        slotProps={{ input: { role: 'switch' } }}
                        disabled={!isStreaming || Boolean(joinedSdrId) || busy}
                        onChange={toggleBackground} />}
                    label={<Typography variant="body2">{t('background.keep_receiving', { defaultValue: 'Keep receiving in background' })}</Typography>}
                />
            </Tooltip>
        </Box>
    );
}
