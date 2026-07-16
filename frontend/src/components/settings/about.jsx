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

import React from 'react';
import { useSelector } from 'react-redux';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Button,
    Card,
    Chip,
    Divider,
    Link,
    Paper,
    Stack,
    Typography,
    useTheme,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import GitHubIcon from '@mui/icons-material/GitHub';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useTranslation } from 'react-i18next';
import { GroundStationLogoGreenBlue } from '../common/dataurl-icons.jsx';

const AboutPage = () => {
    const theme = useTheme();
    const { t } = useTranslation('settings');
    const versionInfo = useSelector((state) => state.version?.data);

    const featureItems = [
        'Real-time Orbit Tracking: Track Earth-orbiting targets using Skyfield/SGP4 propagation from stored orbital elements.',
        'Configurable Orbital Sources + Metadata Enrichment: Sync orbital data from configured sources (default CelesTrak feeds) and enrich satellites/transmitters from SatNOGS APIs.',
        'Multi-Target Tracker Instances: Run multiple tracker instances in parallel (target-N slots), each with independent runtime state.',
        'Automated Antenna Rotator Control: Drive connected rotators with continuous az/el updates, limit checks, and anti-thrashing retarget logic.',
        'Rig Control with Doppler Correction: Control compatible rigs (rigctld/Hamlib paths) with RX/TX Doppler-corrected tuning during tracking.',
        'SDR Hardware Support: RTL-SDR (USB/rtl_tcp), SoapySDR (local/remote), UHD/USRP, plus a virtual SigMF Playback SDR.',
        'Live DSP Pipeline: Stream IQ to FFT/waterfall, demodulators, decoders, recorders, and browser consumers through queue-based worker orchestration.',
        'IQ Recording + SigMF Playback: Record IQ as .sigmf-data/.sigmf-meta with metadata, then replay through the same processing pipeline used for live SDR operation.',
        'Data Decoding + Framing Protocols: Decode SSTV, FSK, GFSK, GMSK, BPSK, and GNSS paths with AX.25/USP/GEOSCAN framing support in packet pipelines.',
        'Transcription Services: Real-time demodulated-audio transcription via Gemini Live or Deepgram, with optional translation and file output.',
        'Scheduled Observations: APScheduler-driven AOS/LOS orchestration for automatic start/stop of tracking, SDR, decoding, recording, and transcription tasks.',
        'SatDump Post-Processing: Optional SatDump processing for IQ recordings, including METEOR LRPT/HRPT workflows.',
        'Performance Monitoring: Stream live pipeline metrics including queue utilization, throughput, drops, and component health.',
        'Authentication + User Management: Built-in login with role-based access control for admins and operators.',
        'Interactive Solar System + Mission Targeting: Track selected solar-system bodies and deep-space mission targets through NASA/JPL Horizons-backed vectors.',
    ];

    const backendTechnologies = [
        { name: 'FastAPI', description: 'A fast Python web framework for API services.', url: 'https://fastapi.tiangolo.com/' },
        { name: 'SQLAlchemy', description: 'Python SQL toolkit and ORM.', url: 'https://www.sqlalchemy.org/' },
        { name: 'Skyfield', description: 'Astronomy library for orbital and celestial positions.', url: 'https://rhodesmill.org/skyfield/' },
        { name: 'NASA/JPL Horizons API', description: 'Ephemeris vectors and observer geometry for solar-system body tracking.', url: 'https://ssd-api.jpl.nasa.gov/doc/horizons.html' },
        { name: 'SGP4', description: 'Satellite propagation model implementation.', url: 'https://pypi.org/project/sgp4/' },
        { name: 'Socket.IO', description: 'Realtime bidirectional communication library.', url: 'https://python-socketio.readthedocs.io/en/latest/' },
        { name: 'pyrtlsdr', description: 'Python wrapper for RTL-SDR.', url: 'https://pypi.org/project/pyrtlsdr/' },
        { name: 'SoapySDR', description: 'Vendor-neutral SDR support library.', url: 'https://pypi.org/project/SoapySDR/' },
        { name: 'SatDump', description: 'Satellite decoder suite for weather image workflows.', url: 'https://github.com/SatDump/SatDump' },
        { name: 'gr-satellites', description: 'GNU Radio modules for satellite communications.', url: 'https://github.com/daniestevez/gr-satellites' },
        { name: 'GNSS-SDR', description: 'Open-source software-defined GNSS receiver used by the GNSS decoder path.', url: 'https://github.com/gnss-sdr/gnss-sdr' },
    ];

    const frontendTechnologies = [
        { name: 'React', description: 'UI library for component-based interfaces.', url: 'https://reactjs.org/' },
        { name: 'Redux Toolkit', description: 'Opinionated Redux tooling for state management.', url: 'https://redux-toolkit.js.org/' },
        { name: 'Material-UI', description: 'UI component framework for React.', url: 'https://mui.com/' },
        { name: 'Vite', description: 'Fast frontend bundler and dev server.', url: 'https://vitejs.dev/' },
        { name: 'Socket.IO Client', description: 'Client runtime for realtime Socket.IO communications.', url: 'https://socket.io/docs/v4/client-api/' },
        { name: 'Leaflet', description: 'Interactive map library.', url: 'https://leafletjs.com/' },
        { name: 'MapLibre Maps', description: 'Open-source map rendering engine used for 2D and globe map views.', url: 'https://maplibre.org/' },
        { name: 'satellite.js', description: 'JavaScript library for orbit propagation.', url: 'https://github.com/shashwatak/satellite-js' },
    ];

    const externalApis = [
        { name: 'CelesTrak', description: 'Orbital element feeds used for target synchronization.', url: 'https://celestrak.org/' },
        { name: 'SatNOGS API', description: 'Satellite and transmitter metadata synchronization.', url: 'https://db.satnogs.org/api/' },
        { name: 'NASA/JPL Horizons API', description: 'Ephemeris vectors and observer geometry for solar-system targets.', url: 'https://ssd-api.jpl.nasa.gov/doc/horizons.html' },
        { name: 'Deepgram Streaming API', description: 'Realtime speech-to-text provider for demodulated audio.', url: 'https://developers.deepgram.com/' },
        { name: 'Google Gemini Live API', description: 'Realtime transcription provider with optional translation workflows.', url: 'https://ai.google.dev/gemini-api/docs/live' },
        { name: 'Google Cloud Translation API', description: 'Optional translation for Deepgram transcription outputs.', url: 'https://cloud.google.com/translate/docs/reference/rest' },
    ];

    const sdrSupport = [
        'RTL-SDR (USB or rtl_tcp) workers',
        'Airspy / AirspyHF+ native worker support (AirspyHF+ currently untested)',
        'SoapySDR devices locally or through SoapyRemote: RTL-SDR, Airspy, HackRF, HydraSDR, LimeSDR, PlutoSDR, UHD/USRP, and SDRplay (RSP series)',
        'UHD/USRP radios via a UHD worker',
        'GNSS-SDR integration for GNSS decoding workflows (requires gnss-sdr available in PATH)',
        'Need another SoapySDR device? Open a GitHub issue and request support.',
    ];

    return (
        <Paper elevation={3} sx={{ p: 2, mt: 0, borderRadius: 0 }}>
            <Stack spacing={2}>
                <Card elevation={1} sx={{ p: 2 }}>
                    <Grid container spacing={2} columns={12} alignItems="center">
                        <Grid size={{ xs: 12, md: 8 }}>
                            <Stack direction="row" spacing={2} alignItems="center">
                                <img src={GroundStationLogoGreenBlue} alt="Ground Station Logo" style={{ height: '56px', width: 'auto' }} />
                                <Box>
                                    <Typography variant="h4" sx={{ fontWeight: 700 }}>
                                        Ground Station
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {t('about.intro', { defaultValue: 'Open-source, browser-based application for tracking satellites and celestial targets, controlling station hardware, and receiving, decoding, and recording SDR signals.' })}
                                    </Typography>
                                </Box>
                            </Stack>
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Stack direction={{ xs: 'column', sm: 'row', md: 'column' }} spacing={1} alignItems={{ xs: 'stretch', md: 'flex-end' }}>
                                <Button
                                    variant="outlined"
                                    startIcon={<GitHubIcon />}
                                    endIcon={<OpenInNewIcon fontSize="small" />}
                                    component={Link}
                                    href="https://github.com/sgoudelis/ground-station"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={t('about.repo_link_aria', { defaultValue: 'Open Ground Station GitHub repository in a new tab' })}
                                    underline="none"
                                >
                                    {t('about.repo', { defaultValue: 'Repository' })}
                                </Button>
                                <Button
                                    variant="text"
                                    component={Link}
                                    href="https://github.com/sgoudelis/ground-station/blob/main/LICENSE"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={t('about.license_link_aria', { defaultValue: 'Open project license in a new tab' })}
                                    underline="hover"
                                >
                                    {t('about.license', { defaultValue: 'GPL-3.0 License' })}
                                </Button>
                            </Stack>
                        </Grid>
                    </Grid>

                    {versionInfo && (
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
                            {versionInfo.version && <Chip size="small" color="primary" label={`v${versionInfo.version}`} />}
                            {versionInfo.environment && (
                                <Chip
                                    size="small"
                                    color={versionInfo.environment === 'production' ? 'success' : 'warning'}
                                    label={versionInfo.environment}
                                    sx={{ textTransform: 'capitalize' }}
                                />
                            )}
                            {versionInfo.buildDate && (
                                <Chip
                                    size="small"
                                    variant="outlined"
                                    label={`${t('about.build', { defaultValue: 'Build' })}: ${versionInfo.buildDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}`}
                                />
                            )}
                            {versionInfo.gitCommit && (
                                <Chip
                                    size="small"
                                    variant="outlined"
                                    sx={{ fontFamily: 'monospace' }}
                                    label={`${t('about.commit', { defaultValue: 'Commit' })}: ${versionInfo.gitCommit}`}
                                />
                            )}
                            {versionInfo.system?.cpu?.architecture && (
                                <Chip
                                    size="small"
                                    variant="outlined"
                                    label={`${t('about.arch', { defaultValue: 'Arch' })}: ${versionInfo.system.cpu.architecture}`}
                                />
                            )}
                        </Stack>
                    )}
                </Card>

                <Grid container spacing={2} columns={12}>
                    <Grid size={{ xs: 12, lg: 7 }}>
                        <Card elevation={1} sx={{ p: 2, height: '100%' }}>
                            <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
                                {t('about.features_title', { defaultValue: 'Key Features' })}
                            </Typography>
                            <Divider sx={{ my: 1.5 }} />
                            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                                {featureItems.map((feature, index) => (
                                    <Box component="li" key={index} sx={{ mb: 1 }}>
                                        <Typography variant="body2">{feature}</Typography>
                                    </Box>
                                ))}
                            </Box>
                        </Card>
                    </Grid>

                    <Grid size={{ xs: 12, lg: 5 }}>
                        <Stack spacing={2}>
                            <Card elevation={1} sx={{ p: 2 }}>
                                <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
                                    {t('about.sdr_support_title', { defaultValue: 'SDR Device Support' })}
                                </Typography>
                                <Divider sx={{ my: 1.5 }} />
                                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                                    {sdrSupport.map((device, index) => (
                                        <Box component="li" key={index} sx={{ mb: 1 }}>
                                            <Typography variant="body2">{device}</Typography>
                                        </Box>
                                    ))}
                                </Box>
                            </Card>
                        </Stack>
                    </Grid>
                </Grid>

                <Accordion defaultExpanded>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                            {t('about.technologies_title', { defaultValue: 'Third-Party Libraries and APIs' })}
                        </Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                        <Grid container spacing={2} columns={12}>
                            <Grid size={{ xs: 12, md: 4 }}>
                                <Card variant="outlined" sx={{ p: 1.5, height: '100%' }}>
                                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                        {t('about.backend_stack', { defaultValue: 'Backend Stack' })}
                                    </Typography>
                                    <Divider sx={{ my: 1 }} />
                                    <Stack spacing={1}>
                                        {backendTechnologies.map((tech) => (
                                            <Box key={tech.name}>
                                                <Link
                                                    href={tech.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    aria-label={`${tech.name} (opens in new tab)`}
                                                    sx={{ fontWeight: 600 }}
                                                >
                                                    {tech.name}
                                                </Link>
                                                <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                                                    {tech.description}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Stack>
                                </Card>
                            </Grid>

                            <Grid size={{ xs: 12, md: 4 }}>
                                <Card variant="outlined" sx={{ p: 1.5, height: '100%' }}>
                                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                        {t('about.frontend_stack', { defaultValue: 'Frontend Stack' })}
                                    </Typography>
                                    <Divider sx={{ my: 1 }} />
                                    <Stack spacing={1}>
                                        {frontendTechnologies.map((tech) => (
                                            <Box key={tech.name}>
                                                <Link
                                                    href={tech.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    aria-label={`${tech.name} (opens in new tab)`}
                                                    sx={{ fontWeight: 600 }}
                                                >
                                                    {tech.name}
                                                </Link>
                                                <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                                                    {tech.description}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Stack>
                                </Card>
                            </Grid>

                            <Grid size={{ xs: 12, md: 4 }}>
                                <Card variant="outlined" sx={{ p: 1.5, height: '100%' }}>
                                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                        {t('about.external_apis', { defaultValue: 'External APIs and Data Sources' })}
                                    </Typography>
                                    <Divider sx={{ my: 1 }} />
                                    <Stack spacing={1}>
                                        {externalApis.map((api) => (
                                            <Box key={api.name}>
                                                <Link
                                                    href={api.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    aria-label={`${api.name} (opens in new tab)`}
                                                    sx={{ fontWeight: 600 }}
                                                >
                                                    {api.name}
                                                </Link>
                                                <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                                                    {api.description}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Stack>
                                </Card>
                            </Grid>
                        </Grid>
                    </AccordionDetails>
                </Accordion>

                <Card elevation={1} sx={{ p: 2, border: `1px solid ${theme.palette.info.main}33` }}>
                    <Typography variant="body2" color="text.secondary">
                        <strong>{t('about.note_label', { defaultValue: 'Note' })}:</strong>{' '}
                        {t('about.note_text', { defaultValue: 'The FM, AM, and SSB demodulator implementations were developed with assistance from Claude AI (Anthropic). These sections are marked in source and licensed under GPL-3.0 like the rest of the project.' })}
                    </Typography>
                </Card>
            </Stack>
        </Paper>
    );
};

export default AboutPage;
