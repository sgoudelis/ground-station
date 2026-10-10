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
        t('about.real_time_orbit_tracking', { defaultValue: 'Real-time Orbit Tracking: Track Earth-orbiting targets using Skyfield/SGP4 propagation from stored orbital elements.' }),
        t('about.configurable_orbital_sources_metadata_enrichment', { defaultValue: 'Configurable Orbital Sources + Metadata Enrichment: Sync orbital data from configured sources (default CelesTrak feeds) and enrich satellites/transmitters from SatNOGS APIs.' }),
        t('about.multi_target_tracker_instances', { defaultValue: 'Multi-Target Tracker Instances: Run multiple tracker instances in parallel (target-N slots), each with independent runtime state.' }),
        t('about.automated_antenna_rotator_control', { defaultValue: 'Automated Antenna Rotator Control: Drive connected rotators with continuous az/el updates, limit checks, and anti-thrashing retarget logic.' }),
        t('about.rig_control_with_doppler_correction', { defaultValue: 'Rig Control with Doppler Correction: Control compatible rigs (rigctld/Hamlib paths) with RX/TX Doppler-corrected tuning during tracking.' }),
        t('about.sdr_hardware_support', { defaultValue: 'SDR Hardware Support: RTL-SDR (USB/rtl_tcp), SoapySDR (local/remote), UHD/USRP, plus a virtual SigMF Playback SDR.' }),
        t('about.live_dsp_pipeline', { defaultValue: 'Live DSP Pipeline: Stream IQ to FFT/waterfall, demodulators, decoders, recorders, and browser consumers through queue-based worker orchestration.' }),
        t('about.iq_recording_sigmf_playback', { defaultValue: 'IQ Recording + SigMF Playback: Record IQ as .sigmf-data/.sigmf-meta with metadata, then replay through the same processing pipeline used for live SDR operation.' }),
        t('about.data_decoding_framing_protocols', { defaultValue: 'Data Decoding + Framing Protocols: Decode SSTV, FSK, GFSK, GMSK, BPSK, and GNSS paths with AX.25/USP/GEOSCAN framing support in packet pipelines.' }),
        t('about.transcription_services', { defaultValue: 'Transcription Services: Real-time demodulated-audio transcription via Gemini Live or Deepgram, with optional translation and file output.' }),
        t('about.scheduled_observations', { defaultValue: 'Scheduled Observations: APScheduler-driven AOS/LOS orchestration for automatic start/stop of tracking, SDR, decoding, recording, and transcription tasks.' }),
        t('about.satdump_post_processing', { defaultValue: 'SatDump Post-Processing: Optional SatDump processing for IQ recordings, including METEOR LRPT/HRPT workflows.' }),
        t('about.performance_monitoring', { defaultValue: 'Performance Monitoring: Stream live pipeline metrics including queue utilization, throughput, drops, and component health.' }),
        t('about.authentication_user_management', { defaultValue: 'Authentication + User Management: Built-in login with role-based access control for admins and operators.' }),
        t('about.interactive_solar_system_mission_targeting_track', { defaultValue: 'Interactive Solar System + Mission Targeting: Track selected solar-system bodies and deep-space mission targets through NASA/JPL Horizons-backed vectors.' }),
    ];

    const backendTechnologies = [
        { name: 'FastAPI', description: t('about.a_fast_python_web_framework_for_api_services', { defaultValue: 'A fast Python web framework for API services.' }), url: 'https://fastapi.tiangolo.com/' },
        { name: 'SQLAlchemy', description: t('about.python_sql_toolkit_and_orm', { defaultValue: 'Python SQL toolkit and ORM.' }), url: 'https://www.sqlalchemy.org/' },
        { name: 'Skyfield', description: t('about.astronomy_library_for_orbital_and_celestial_posi', { defaultValue: 'Astronomy library for orbital and celestial positions.' }), url: 'https://rhodesmill.org/skyfield/' },
        { name: 'NASA/JPL Horizons API', description: t('about.ephemeris_vectors_and_observer_geometry_for_sola', { defaultValue: 'Ephemeris vectors and observer geometry for solar-system body tracking.' }), url: 'https://ssd-api.jpl.nasa.gov/doc/horizons.html' },
        { name: 'SGP4', description: t('about.satellite_propagation_model_implementation', { defaultValue: 'Satellite propagation model implementation.' }), url: 'https://pypi.org/project/sgp4/' },
        { name: 'Socket.IO', description: t('about.realtime_bidirectional_communication_library', { defaultValue: 'Realtime bidirectional communication library.' }), url: 'https://python-socketio.readthedocs.io/en/latest/' },
        { name: 'pyrtlsdr', description: t('about.python_wrapper_for_rtl_sdr', { defaultValue: 'Python wrapper for RTL-SDR.' }), url: 'https://pypi.org/project/pyrtlsdr/' },
        { name: 'SoapySDR', description: t('about.vendor_neutral_sdr_support_library', { defaultValue: 'Vendor-neutral SDR support library.' }), url: 'https://pypi.org/project/SoapySDR/' },
        { name: 'SatDump', description: t('about.satellite_decoder_suite_for_weather_image_workfl', { defaultValue: 'Satellite decoder suite for weather image workflows.' }), url: 'https://github.com/SatDump/SatDump' },
        { name: 'gr-satellites', description: t('about.gnu_radio_modules_for_satellite_communications', { defaultValue: 'GNU Radio modules for satellite communications.' }), url: 'https://github.com/daniestevez/gr-satellites' },
        { name: 'GNSS-SDR', description: t('about.open_source_software_defined_gnss_receiver_used_', { defaultValue: 'Open-source software-defined GNSS receiver used by the GNSS decoder path.' }), url: 'https://github.com/gnss-sdr/gnss-sdr' },
    ];

    const frontendTechnologies = [
        { name: 'React', description: t('about.ui_library_for_component_based_interfaces', { defaultValue: 'UI library for component-based interfaces.' }), url: 'https://reactjs.org/' },
        { name: 'Redux Toolkit', description: t('about.opinionated_redux_tooling_for_state_management', { defaultValue: 'Opinionated Redux tooling for state management.' }), url: 'https://redux-toolkit.js.org/' },
        { name: 'Material-UI', description: t('about.ui_component_framework_for_react', { defaultValue: 'UI component framework for React.' }), url: 'https://mui.com/' },
        { name: 'Vite', description: t('about.fast_frontend_bundler_and_dev_server', { defaultValue: 'Fast frontend bundler and dev server.' }), url: 'https://vitejs.dev/' },
        { name: 'Socket.IO Client', description: t('about.client_runtime_for_realtime_socket_io_communicat', { defaultValue: 'Client runtime for realtime Socket.IO communications.' }), url: 'https://socket.io/docs/v4/client-api/' },
        { name: 'Leaflet', description: t('about.interactive_map_library', { defaultValue: 'Interactive map library.' }), url: 'https://leafletjs.com/' },
        { name: 'MapLibre Maps', description: t('about.open_source_map_rendering_engine_used_for_2d_and', { defaultValue: 'Open-source map rendering engine used for 2D and globe map views.' }), url: 'https://maplibre.org/' },
        { name: 'satellite.js', description: t('about.javascript_library_for_orbit_propagation', { defaultValue: 'JavaScript library for orbit propagation.' }), url: 'https://github.com/shashwatak/satellite-js' },
    ];

    const externalApis = [
        { name: 'CelesTrak', description: t('about.orbital_element_feeds_used_for_target_synchroniz', { defaultValue: 'Orbital element feeds used for target synchronization.' }), url: 'https://celestrak.org/' },
        { name: 'SatNOGS API', description: t('about.satellite_and_transmitter_metadata_synchronizati', { defaultValue: 'Satellite and transmitter metadata synchronization.' }), url: 'https://db.satnogs.org/api/' },
        { name: 'NASA/JPL Horizons API', description: t('about.ephemeris_vectors_and_observer_geometry_for_sola_2', { defaultValue: 'Ephemeris vectors and observer geometry for solar-system targets.' }), url: 'https://ssd-api.jpl.nasa.gov/doc/horizons.html' },
        { name: 'Deepgram Streaming API', description: t('about.realtime_speech_to_text_provider_for_demodulated', { defaultValue: 'Realtime speech-to-text provider for demodulated audio.' }), url: 'https://developers.deepgram.com/' },
        { name: 'Google Gemini Live API', description: t('about.realtime_transcription_provider_with_optional_tr', { defaultValue: 'Realtime transcription provider with optional translation workflows.' }), url: 'https://ai.google.dev/gemini-api/docs/live' },
        { name: 'Google Cloud Translation API', description: t('about.optional_translation_for_deepgram_transcription_', { defaultValue: 'Optional translation for Deepgram transcription outputs.' }), url: 'https://cloud.google.com/translate/docs/reference/rest' },
    ];

    const sdrSupport = [
        t('about.rtl_sdr_usb_or_rtl_tcp_workers', { defaultValue: 'RTL-SDR (USB or rtl_tcp) workers' }),
        t('about.airspy_airspyhf_native_worker_support_airspyhf_c', { defaultValue: 'Airspy / AirspyHF+ native worker support (AirspyHF+ currently untested)' }),
        t('about.soapysdr_devices_locally_or_through_soapyremote_', { defaultValue: 'SoapySDR devices locally or through SoapyRemote: RTL-SDR, Airspy, HackRF, HydraSDR, LimeSDR, PlutoSDR, UHD/USRP, and SDRplay (RSP series)' }),
        t('about.uhd_usrp_radios_via_a_uhd_worker', { defaultValue: 'UHD/USRP radios via a UHD worker' }),
        t('about.gnss_sdr_integration_for_gnss_decoding_workflows', { defaultValue: 'GNSS-SDR integration for GNSS decoding workflows (requires gnss-sdr available in PATH)' }),
        t('about.need_another_soapysdr_device_open_a_github_issue', { defaultValue: 'Need another SoapySDR device? Open a GitHub issue and request support.' }),
    ];

    return (
        <Paper elevation={3} sx={{ p: 2, mt: 0, borderRadius: 0 }}>
            <Stack spacing={2}>
                <Card elevation={1} sx={{ p: 2 }}>
                    <Grid container spacing={2} columns={12} alignItems="center">
                        <Grid size={{ xs: 12, md: 8 }}>
                            <Stack direction="row" spacing={2} alignItems="center">
                                <img src={GroundStationLogoGreenBlue} alt={t('about.ground_station_logo', { defaultValue: 'Ground Station Logo' })} style={{ height: '56px', width: 'auto' }} />
                                <Box>
                                    <Typography variant="h4" sx={{ fontWeight: 700 }}>
                                        {t('about.ground_station', { defaultValue: 'Ground Station' })}
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
