/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 */

import React from 'react';
import { Typography, Divider } from '@mui/material';
import Grid from '@mui/material/Grid';
import { useSocket } from "../../common/socket.jsx";
import { useTranslation } from 'react-i18next';

const SocketInfoCard = () => {
    const { t } = useTranslation('settings');
    const { socket } = useSocket();

    return (
        <>
            <Typography variant="h6" gutterBottom>
                {t('socket_info_card.socket_io_connection_information', { defaultValue: 'Socket.IO Connection Information' })}
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('socket_info_card.real_time_websocket_connection_status_and_diagnostics', { defaultValue: 'Real-time WebSocket connection status and diagnostics' })}
            </Typography>

            <Grid container spacing={2} columns={16}>
                <Grid size={16}>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        {t('socket_info_card.connection_status', { defaultValue: 'Connection Status' })}
                    </Typography>
                    <Divider sx={{ mb: 1 }} />
                </Grid>

                <Grid size={8}>
                    {t('socket_info_card.session_id', { defaultValue: 'Session ID' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('socket_info_card.socket_io_client_session_identifier', { defaultValue: 'Socket.IO client session identifier' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="body1" sx={{ wordBreak: 'break-word', fontFamily: 'monospace' }}>
                        {socket?.id || 'Not connected'}
                    </Typography>
                </Grid>

                <Grid size={8}>
                    {t('socket_info_card.connected', { defaultValue: 'Connected' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('socket_info_card.socket_connection_status', { defaultValue: 'Socket connection status' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="body1" fontWeight="bold" color={socket?.connected ? 'success.main' : 'error.main'}>
                        {socket?.connected ? 'Yes' : 'No'}
                    </Typography>
                </Grid>

                <Grid size={8}>
                    {t('socket_info_card.engine_ready_state', { defaultValue: 'Engine Ready State' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('socket_info_card.socket_engine_connection_state', { defaultValue: 'Socket engine connection state' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="body1">
                        {socket?.io?.engine?.readyState || 'N/A'}
                    </Typography>
                </Grid>

                <Grid size={16}>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ mt: 2 }}>
                        {t('socket_info_card.connection_details', { defaultValue: 'Connection Details' })}
                    </Typography>
                    <Divider sx={{ mb: 1 }} />
                </Grid>

                <Grid size={8}>
                    {t('socket_info_card.transport', { defaultValue: 'Transport' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('socket_info_card.socket_io_transport_protocol', { defaultValue: 'Socket.IO transport protocol' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="body1">
                        {socket?.io?.engine?.transport?.name || 'N/A'}
                    </Typography>
                </Grid>

                <Grid size={8}>
                    {t('socket_info_card.backend_url', { defaultValue: 'Backend URL' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('socket_info_card.websocket_server_url', { defaultValue: 'WebSocket server URL' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="body2" sx={{ wordBreak: 'break-word', fontFamily: 'monospace' }}>
                        {socket?.io?.uri || 'N/A'}
                    </Typography>
                </Grid>

                <Grid size={8}>
                    {t('socket_info_card.reconnection_attempts', { defaultValue: 'Reconnection Attempts' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('socket_info_card.number_of_reconnection_attempts', { defaultValue: 'Number of reconnection attempts' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="body1">
                        {socket?.io?._reconnectionAttempts || 0}
                    </Typography>
                </Grid>
            </Grid>
        </>
    );
};

export default SocketInfoCard;
