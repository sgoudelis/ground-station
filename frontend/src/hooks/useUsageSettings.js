/** Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Activity consent shares the page's actions, but never enters its config payload.
export const useUsageSettings = (socket) => {
    const { t } = useTranslation('settings');
    const [status, setStatus] = useState(null);
    const [enabled, setEnabled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const request = useRef(0);

    const reload = useCallback(async () => {
        const id = ++request.current;
        setLoading(true);
        try {
            if (!socket?.connected) throw new Error(t('usage.error'));
            const reply = await socket.timeout(15000).emitWithAck('api.call', { cmd: 'usage.get' });
            if (id !== request.current) return;
            if (!reply?.success) throw new Error(reply?.error || t('usage.error'));
            setStatus(reply.data);
            setEnabled(reply.data.enabled);
            setError('');
        } catch (failure) {
            if (id === request.current) setError(failure.message);
        } finally {
            if (id === request.current) setLoading(false);
        }
    }, [socket, t]);

    useEffect(() => {
        void reload();
        socket?.on('connect', reload);
        // Ignore old acknowledgements after reconnecting or leaving the page.
        return () => { request.current += 1; socket?.off('connect', reload); };
    }, [socket, reload]);

    const dirty = Boolean(status && enabled !== status.enabled);
    const save = async () => {
        if (!dirty) return true;
        if (loading || !status || status.storage_error) return false;
        const id = ++request.current;
        setError('');
        try {
            if (!socket?.connected) throw new Error(t('usage.error'));
            const reply = await socket.timeout(15000).emitWithAck('api.call', {
                cmd: 'usage.update', data: { enabled },
            });
            if (id !== request.current) return false;
            if (!reply?.success) throw new Error(reply?.error || t('app_settings.save_failed'));
            setStatus(reply.data);
            setEnabled(reply.data.enabled);
            return true;
        } catch (failure) {
            if (id === request.current) setError(failure.message);
            return false;
        }
    };

    return {
        status, enabled, loading, error, dirty, reload, save,
        onChange: (value) => { setEnabled(value); setError(''); },
        reset: () => { setEnabled(status?.enabled ?? false); setError(''); },
    };
};
