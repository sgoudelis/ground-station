import React from 'react';
import {Alert,Box,Checkbox,Chip,Dialog,DialogActions,DialogContent,DialogContentText,DialogTitle,FormControlLabel,FormGroup,IconButton,Link,MenuItem,Paper,Stack,TextField,Typography,} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';
import { useSocket } from '../common/socket.jsx';
import { SettingsSection, SettingsSurface, SettingsSurfaceHeader } from '../settings/shared/index.js';

const tokenCardSx = {
    p: { xs: 1.5, sm: 2 },
    borderRadius: 1,
    bgcolor: (theme) => theme.palette.mode === 'dark'
        ? alpha(theme.palette.grey[700], 0.18)
        : alpha(theme.palette.grey[100], 0.9),
};

async function request(socket, cmd, data = null) {
    if (!socket?.connected) {
        throw new Error('Socket is disconnected. Reconnect before managing API tokens.');
    }
    const reply = await socket.timeout(20000).emitWithAck('api.call', { cmd, data });
    if (!reply?.success) {
        throw new Error(reply?.error || 'API-token request failed.');
    }
    return reply.data;
}

function showDate(value) {
    return value ? new Date(value).toLocaleString() : '—';
}

export default function ApiTokensPage() {
    const { t } = useTranslation('dashboard');
    const { socket } = useSocket();
    const [tokens, setTokens] = React.useState([]);
    const [scopes, setScopes] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const [createOpen, setCreateOpen] = React.useState(false);
    const [verificationOpen, setVerificationOpen] = React.useState(false);
    const [verificationError, setVerificationError] = React.useState('');
    const [name, setName] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [selectedScopes, setSelectedScopes] = React.useState(['station:read']);
    const [expiry, setExpiry] = React.useState('365');
    const [createdSecret, setCreatedSecret] = React.useState('');
    const [copyError, setCopyError] = React.useState('');
    const [renameTarget, setRenameTarget] = React.useState(null);
    const [renameValue, setRenameValue] = React.useState('');
    const [revokeTarget, setRevokeTarget] = React.useState(null);

    const reload = React.useCallback(async () => {
        const data = await request(socket, 'tokens.list');
        setTokens(data || []);
    }, [socket]);

    React.useEffect(() => {
        let active = true;
        const load = () => {
            setLoading(true);
            Promise.all([request(socket, 'tokens.list'), request(socket, 'tokens.scopes')])
                .then(([tokenData, scopeData]) => {
                    if (!active) return;
                    setTokens(tokenData || []);
                    setScopes(scopeData || []);
                    setError('');
                })
                .catch((cause) => { if (active) setError(cause.message); })
                .finally(() => { if (active) setLoading(false); });
        };
        if (socket?.connected) load();
        socket?.on('connect', load);
        if (!socket) {
            setError('Socket is unavailable.');
            setLoading(false);
        }
        return () => { active = false; socket?.off('connect', load); };
    }, [socket]);

    const createToken = async () => {
        setBusy(true);
        setVerificationError('');
        try {
            const payload = await request(socket, 'tokens.create', {
                name,
                password,
                scopes: selectedScopes,
                expires_in_days: expiry === 'never' ? null : Number(expiry),
            });
            setVerificationOpen(false);
            setCreatedSecret(payload.token);
            setCopyError('');
            setName('');
            setSelectedScopes(['station:read']);
            // A list refresh failure must not prompt a retry of an already-created token.
            try {
                await reload();
            } catch (cause) {
                setError(cause.message);
            }
        } catch (cause) {
            setVerificationError(cause.message);
        } finally {
            setPassword('');
            setBusy(false);
        }
    };

    const closeVerification = () => {
        if (busy) return;
        setVerificationOpen(false);
        setVerificationError('');
        setPassword('');
        setCreateOpen(true);
    };

    const renameToken = async () => {
        setBusy(true);
        setError('');
        try {
            await request(socket, 'tokens.rename', { token_id: renameTarget.id, name: renameValue });
            setRenameTarget(null);
            await reload();
        } catch (cause) {
            setError(cause.message);
        } finally {
            setBusy(false);
        }
    };

    const revokeToken = async () => {
        setBusy(true);
        setError('');
        try {
            await request(socket, 'tokens.revoke', { token_id: revokeTarget.id });
            setRevokeTarget(null);
            await reload();
        } catch (cause) {
            setError(cause.message);
        } finally {
            setBusy(false);
        }
    };

    const scopeLabel = (id) => scopes.find((scope) => scope.id === id)?.description || id;

    return (
        <SettingsSurface>
            <Stack spacing={2}>
                <SettingsSurfaceHeader
                    title={t('api_tokens.title', { defaultValue: 'API Tokens' })}
                    subtitle={t('api_tokens.intro', { defaultValue: 'Create personal tokens for external applications. Each token has only the access you select.' })}
                    actions={(
                        <CapsButton size="small" variant="contained" startIcon={<AddIcon />}
                            onClick={() => { setError(''); setCreateOpen(true); }} disabled={loading || scopes.length === 0}>
                            {t('api_tokens.create', { defaultValue: 'Create token' })}
                        </CapsButton>
                    )}
                />

                <Alert severity="info">
                    {t('api_tokens.reference_help', { defaultValue: 'Building a custom app or Home Assistant integration? The API reference lists endpoints and lets you try requests using a token from this page.' })}
                    {' '}
                    <Link href="/api/docs" target="_blank" rel="noopener noreferrer">
                        {t('api_tokens.reference_link', { defaultValue: 'Open API reference' })}
                    </Link>
                </Alert>

                {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
                <SettingsSection
                    title={t('api_tokens.list_title', { defaultValue: 'Your tokens' })}
                    description={t('api_tokens.list_help', { defaultValue: 'Review access, expiration, and usage. Revoke tokens you no longer need.' })}
                >
                    {loading ? (
                        <Typography variant="body2">{t('api_tokens.loading', { defaultValue: 'Loading tokens…' })}</Typography>
                    ) : tokens.length === 0 ? (
                        <Box sx={{ py: 3, textAlign: 'center' }}>
                            <Typography variant="body2" color="text.secondary">
                                {t('api_tokens.empty', { defaultValue: 'You have no API tokens yet.' })}
                            </Typography>
                        </Box>
                    ) : (
                        <Stack spacing={1.5}>
                            {tokens.map((token) => (
                                <Paper key={token.id} variant="outlined" sx={tokenCardSx}>
                                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                                        <Box sx={{ minWidth: 0 }}>
                                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                                <Typography variant="subtitle1" fontWeight={600}>{token.name}</Typography>
                                                <Chip size="small" label={token.status} color={token.status === 'active' ? 'success' : 'default'} />
                                            </Stack>
                                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontFamily: 'monospace' }}>
                                                {token.hint}
                                            </Typography>
                                        </Box>
                                        {token.status === 'active' && (
                                            <Stack direction="row" alignItems="center">
                                                <IconButton size="small" aria-label={t('api_tokens.rename', { defaultValue: 'Rename token' })}
                                                    onClick={() => { setError(''); setRenameTarget(token); setRenameValue(token.name); }}>
                                                    <EditOutlinedIcon fontSize="small" />
                                                </IconButton>
                                                <IconButton size="small" color="error" aria-label={t('api_tokens.revoke', { defaultValue: 'Revoke token' })}
                                                    onClick={() => { setError(''); setRevokeTarget(token); }}>
                                                    <DeleteOutlineIcon fontSize="small" />
                                                </IconButton>
                                            </Stack>
                                        )}
                                    </Stack>
                                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                                        {token.scopes.map((scope) => <Chip key={scope} size="small" label={scope} variant="outlined" />)}
                                    </Stack>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                                        {t('api_tokens.created', { defaultValue: 'Created' })}: {showDate(token.created_at)} ·
                                        {' '}{t('api_tokens.last_used', { defaultValue: 'Last used' })}: {showDate(token.last_used_at)} ·
                                        {' '}{t('api_tokens.expires', { defaultValue: 'Expires' })}: {token.expires_at ? showDate(token.expires_at) : t('api_tokens.never', { defaultValue: 'Never' })}
                                    </Typography>
                                </Paper>
                            ))}
                        </Stack>
                    )}
                </SettingsSection>
            </Stack>

            <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
                <DialogTitle>{t('api_tokens.create', { defaultValue: 'Create token' })}</DialogTitle>
                <DialogContent sx={{ pt: '16px !important' }}>
                    <Stack spacing={2}>
                        {error && <Alert severity="error">{error}</Alert>}
                        <TextField label={t('api_tokens.name', { defaultValue: 'Name' })} value={name}
                            onChange={(event) => setName(event.target.value)} inputProps={{ maxLength: 80 }} autoFocus fullWidth size="small" />
                        <Box>
                            <Typography variant="subtitle2" gutterBottom>{t('api_tokens.scopes', { defaultValue: 'Access scopes' })}</Typography>
                            <FormGroup>
                                {scopes.map((scope) => (
                                    <FormControlLabel key={scope.id}
                                        control={<Checkbox checked={selectedScopes.includes(scope.id)} onChange={(event) => {
                                            setSelectedScopes((current) => event.target.checked
                                                ? [...current, scope.id]
                                                : current.filter((id) => id !== scope.id));
                                        }} />}
                                        label={<><Typography variant="body2">{scope.id}</Typography>
                                            <Typography variant="caption" color="text.secondary">{scopeLabel(scope.id)}</Typography></>}
                                    />
                                ))}
                            </FormGroup>
                        </Box>
                        <TextField select label={t('api_tokens.expiry', { defaultValue: 'Expires after' })}
                            value={expiry} onChange={(event) => setExpiry(event.target.value)} fullWidth size="small">
                            <MenuItem value="30">30 {t('api_tokens.days', { defaultValue: 'days' })}</MenuItem>
                            <MenuItem value="90">90 {t('api_tokens.days', { defaultValue: 'days' })}</MenuItem>
                            <MenuItem value="365">365 {t('api_tokens.days', { defaultValue: 'days' })}</MenuItem>
                            <MenuItem value="never">{t('api_tokens.never', { defaultValue: 'Never' })}</MenuItem>
                        </TextField>
                        <Typography variant="caption" color="text.secondary">
                            {t('api_tokens.fixed_scopes', { defaultValue: 'Scopes cannot be changed later. Create a replacement token to change access.' })}
                        </Typography>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <CapsButton onClick={() => setCreateOpen(false)}>{t('api_tokens.cancel', { defaultValue: 'Cancel' })}</CapsButton>
                    <CapsButton onClick={() => {
                        setError('');
                        setVerificationError('');
                        setCreateOpen(false);
                        setVerificationOpen(true);
                    }} variant="contained" disabled={!name.trim() || selectedScopes.length === 0}>
                        {t('api_tokens.continue', { defaultValue: 'Continue' })}
                    </CapsButton>
                </DialogActions>
            </Dialog>

            <Dialog open={verificationOpen} onClose={closeVerification} fullWidth maxWidth="xs" aria-labelledby="token-verification-title">
                <Box component="form" onSubmit={(event) => { event.preventDefault(); if (!busy && password) createToken(); }}>
                    <DialogTitle id="token-verification-title" sx={{ pb: 1 }}>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                            <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'warning.main', color: 'warning.contrastText' }}>
                                <LockOutlinedIcon />
                            </Box>
                            <Typography variant="h6" component="span" fontWeight={700}>
                                {t('api_tokens.verify_title', { defaultValue: 'Verify your identity' })}
                            </Typography>
                        </Stack>
                    </DialogTitle>
                    <DialogContent sx={{ pt: '24px !important' }}>
                        <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
                            {t('api_tokens.verify_message', { defaultValue: 'API tokens grant access to your station. Enter your current password to confirm this token.' })}
                        </Alert>
                        {verificationError && <Alert severity="error" sx={{ mb: 2 }}>{verificationError}</Alert>}
                        <TextField label={t('api_tokens.password', { defaultValue: 'Current password' })}
                            type="password" autoComplete="current-password" value={password} autoFocus fullWidth size="small"
                            onChange={(event) => setPassword(event.target.value)} />
                    </DialogContent>
                    <DialogActions sx={{ px: 3, pb: 2 }}>
                        <CapsButton onClick={closeVerification} disabled={busy}>{t('api_tokens.back', { defaultValue: 'Back' })}</CapsButton>
                        <CapsButton type="submit" variant="contained" disabled={busy || !password}>
                            {t('api_tokens.verify_create', { defaultValue: 'Verify and create token' })}
                        </CapsButton>
                    </DialogActions>
                </Box>
            </Dialog>

            <Dialog open={Boolean(createdSecret)} onClose={() => setCreatedSecret('')} fullWidth maxWidth="sm">
                <DialogTitle>{t('api_tokens.copy_title', { defaultValue: 'Copy your API token' })}</DialogTitle>
                <DialogContent>
                    {copyError && <Alert severity="error" sx={{ mb: 2 }}>{copyError}</Alert>}
                    <DialogContentText sx={{ mb: 2 }}>
                        {t('api_tokens.copy_once', { defaultValue: 'This is the only time the token will be shown. Store it securely before closing this window.' })}
                    </DialogContentText>
                    <TextField value={createdSecret} fullWidth inputProps={{ readOnly: true, style: { fontFamily: 'monospace' } }} />
                </DialogContent>
                <DialogActions>
                    <CapsButton startIcon={<ContentCopyIcon />} onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(createdSecret);
                            setCopyError('');
                        } catch {
                            setCopyError(t('api_tokens.copy_failed', { defaultValue: 'Could not copy automatically. Select and copy the token manually.' }));
                        }
                    }}>
                        {t('api_tokens.copy', { defaultValue: 'Copy' })}
                    </CapsButton>
                    <CapsButton variant="contained" onClick={() => setCreatedSecret('')}>
                        {t('api_tokens.done', { defaultValue: 'Done' })}
                    </CapsButton>
                </DialogActions>
            </Dialog>

            <Dialog open={Boolean(renameTarget)} onClose={() => setRenameTarget(null)} fullWidth maxWidth="xs">
                <DialogTitle>{t('api_tokens.rename', { defaultValue: 'Rename token' })}</DialogTitle>
                <DialogContent sx={{ pt: '16px !important' }}>
                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                    <TextField label={t('api_tokens.name', { defaultValue: 'Name' })} value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)} inputProps={{ maxLength: 80 }} fullWidth size="small" />
                </DialogContent>
                <DialogActions>
                    <CapsButton onClick={() => setRenameTarget(null)} disabled={busy}>{t('api_tokens.cancel', { defaultValue: 'Cancel' })}</CapsButton>
                    <CapsButton onClick={renameToken} disabled={busy || !renameValue.trim()}>{t('api_tokens.save', { defaultValue: 'Save' })}</CapsButton>
                </DialogActions>
            </Dialog>

            <Dialog open={Boolean(revokeTarget)} onClose={() => setRevokeTarget(null)}>
                <DialogTitle>{t('api_tokens.revoke', { defaultValue: 'Revoke token' })}</DialogTitle>
                <DialogContent sx={{ pt: '16px !important' }}>
                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                    <DialogContentText>
                        {t('api_tokens.revoke_confirm', { defaultValue: 'Revoke "{{name}}"? Applications using it will lose access immediately.', name: revokeTarget?.name })}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <CapsButton onClick={() => setRevokeTarget(null)} disabled={busy}>{t('api_tokens.cancel', { defaultValue: 'Cancel' })}</CapsButton>
                    <CapsButton onClick={revokeToken} color="error" disabled={busy}>{t('api_tokens.revoke', { defaultValue: 'Revoke token' })}</CapsButton>
                </DialogActions>
            </Dialog>
        </SettingsSurface>
    );
}
