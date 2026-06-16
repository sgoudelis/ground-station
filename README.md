# Ground Station

[![Tests](https://github.com/sgoudelis/ground-station/actions/workflows/tests.yml/badge.svg)](https://github.com/sgoudelis/ground-station/actions/workflows/tests.yml) [![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0) [![Release](https://github.com/sgoudelis/ground-station/actions/workflows/release-from-images.yml/badge.svg?event=push)](https://github.com/sgoudelis/ground-station/actions/workflows/release-from-images.yml) [![Last Release](https://img.shields.io/github/release-date/sgoudelis/ground-station)](https://github.com/sgoudelis/ground-station/releases/latest) [![Last Commit](https://img.shields.io/github/last-commit/sgoudelis/ground-station)](https://github.com/sgoudelis/ground-station/commits/main)


**Ground Station is a full-featured, open-source software solution for satellite tracking and radio communication.** Designed for amateur radio operators, satellite enthusiasts, and researchers, it provides
a comprehensive and easy-to-use platform for monitoring spacecraft, controlling radio equipment, and receiving
live radio signals from satellites.
This project was built with the help of Claude Code and Codex.

## Screenshots

<div align="center">

### Global Satellite Overview
<img src="frontend/public/ground station - overview page - amateur group.png" alt="Overview page with amateur satellite group" width="450"/>

*Overview page with quick group selection and real-time satellite status indicators*

---

### Multi-Target Tracking Console
<img src="frontend/public/ground station - tracking console - multitargets - iss.png" alt="Multi-target tracking console focused on ISS" width="450"/>

*Multi-target tracking console view showing an active ISS target with per-target control and live tracking telemetry*

---

### SDR Waterfall View
<img src="frontend/public/ground station - waterfall page - transcription - iss.png" alt="Waterfall view with live transcription" width="450"/>

*Waterfall view with live transcription overlay during active satellite communication*

---

### Waterfall Packet Decoding (GMSK)
<img src="frontend/public/ground station - waterfall page - packet decoding gmsk.png" alt="Waterfall packet decoding view with GMSK" width="450"/>

*Waterfall view with live GMSK packet decoding and decoded output details*

---

### Telemetry Packet Viewer (Hex + ASCII)
<img src="frontend/public/ground station - packet viewer - as hexascii.png" alt="Telemetry packet viewer with hex and ASCII columns" width="450"/>

*Packet viewer showing telemetry payload bytes in hex with ASCII side-by-side*

---

### TLE Data Synchronization
<img src="frontend/public/ground station - tle sync page.png" alt="TLE synchronization page" width="450"/>

*TLE synchronization page showing real-time progress and satellite database updates*

---

### SDR Hardware Management
<img src="frontend/public/ground station - sdrs view - table list.png" alt="SDR device management" width="450"/>

*Comprehensive SDR device management interface supporting RTL-SDR, SoapySDR, and UHD/USRP radios with remote capability*

---

### File Browser & Decoders
<img src="frontend/public/ground station - file browser - weather images - decoded packets - recorded transcriptions.png" alt="File browser with decoded outputs and transcriptions" width="450"/>

*File browser view showing decoded weather images, packet outputs, and saved transcriptions*

---

### Observations Overview
<img src="frontend/public/ground station - observations - overview.png" alt="Observations overview" width="450"/>

*Automated observations dashboard with upcoming passes and task status*

---

### DSP Topology & Performance
<img src="frontend/public/ground station - dsp topology - performance.png" alt="DSP topology and performance view" width="450"/>

*Chain of threads and processes IQ samples pass through, showing performance and data flow across the DSP pipeline*

---

</div>

## Key Features

*   **Real-time Orbit Tracking:** Track Earth-orbiting targets using Skyfield/SGP4 propagation from stored orbital elements.
*   **Configurable Orbital Sources + Metadata Enrichment:** Sync orbital data from configured sources (default CelesTrak feeds) and enrich satellites/transmitters from SatNOGS APIs.
*   **Multi-Target Tracker Instances:** Run multiple tracker instances in parallel (`target-N` slots), each with independent runtime state.
*   **Automated Antenna Rotator Control:** Drive connected rotators with continuous az/el updates, limit checks, and anti-thrashing retarget logic.
*   **Rig Control with Doppler Correction:** Control compatible rigs (rigctld/Hamlib paths) with RX/TX Doppler-corrected tuning during tracking.
*   **SDR Hardware Support:** RTL-SDR (USB/rtl_tcp), SoapySDR (local/remote), UHD/USRP, plus a virtual SigMF Playback SDR.
*   **Live DSP Pipeline:** Stream IQ to FFT/waterfall, demodulators, decoders, recorders, and browser consumers through queue-based worker orchestration.
*   **IQ Recording (SigMF):** Record IQ as `.sigmf-data` + `.sigmf-meta` with center frequency, sample rate, session stats, and target satellite metadata.
*   **SigMF Playback:** Replay recorded IQ through the same processing pipeline used for live SDR operation.
*   **Data Decoding + Framing Protocols:** Supported decoder paths include SSTV, FSK, GFSK, GMSK, BPSK, and GNSS, with AX.25/USP/GEOSCAN framing support in the packet pipelines.
*   **Transcription Services:** Real-time demodulated-audio transcription via Gemini Live or Deepgram, with optional translation and file output under `backend/data/transcriptions/`.
*   **Scheduled Observations:** APScheduler-driven AOS/LOS orchestration for automatic start/stop of tracking, SDR, decoding, recording, and transcription tasks.
*   **SatDump Post-Processing:** Optional SatDump processing for IQ recordings, including METEOR LRPT/HRPT pipelines.
*   **Performance Monitoring:** Live pipeline metrics (queue utilization, throughput, drops, and component health) streamed to the frontend.
*   **Responsive Web Interface:** Material-UI + Socket.IO frontend for desktop, tablet, and mobile operation.
*   **Celestial Tracking Integration:** Solar-system/celestial vector support backed by the NASA/JPL Horizons API for non-TLE body tracking paths.

## Scheduled Observations & Automated Pass Recording

Ground Station includes a comprehensive automated observation system that can schedule and execute satellite passes without user intervention:

*   **Monitored Satellites:** Define satellite monitoring templates with hardware configurations, signal parameters, and task definitions. The system automatically generates scheduled observations for all qualifying passes.
*   **Automated Pass Scheduling:** Automatically calculate and schedule upcoming satellite passes based on configurable criteria (minimum elevation, lookahead window). The scheduler uses APScheduler to trigger observations at AOS (Acquisition of Signal) and stop at LOS (Loss of Signal).
*   **Flexible Task Composition:** Each observation can include multiple concurrent tasks: IQ recording (SigMF format), audio recording (WAV), protocol decoding (AFSK, GMSK, SSTV), and optional AI transcription.
*   **Hardware Orchestration:** Automatically controls SDR devices, antenna rotators (with satellite tracking), and rigs (with Doppler correction) during scheduled observations.
*   **Live Observation Capability:** Users can observe any automated pass in real-time through the web interface - view the spectrum waterfall, listen to demodulated audio, and watch live decoder output. When using the same SDR as an automated observation, users can monitor without interference, but be aware that changing the SDR's center frequency or bandwidth will affect the ongoing observation.
*   **Multi-SDR Observing:** Automated observations can run on one SDR while additional SDRs record, decode, and listen to the same pass in parallel.
*   **Status Management:** Real-time observation status tracking (scheduled, running, completed, failed, cancelled, missed) with automatic cleanup of old completed observations.
*   **Session Management:** Automated observations run in isolated internal VFO sessions (namespace: "internal:<observation_id>"). When using different SDRs, user sessions and automated observations operate completely independently without any interference.

## Architecture
<a id="arch-v1"></a>

The Ground Station application is composed of a frontend, a backend, and a set of worker processes.

### High-Level System Architecture

```mermaid
flowchart TB
    %% Cache buster: v5-20251115-updated
    %% Frontend Layer
    A[Frontend: React + Redux + MUI<br/>- Real-time UI updates<br/>- State management<br/>- Interactive satellite maps<br/>- Spectrum & waterfall display<br/>- Audio playback & recording<br/>- IQ recording & playback controls<br/>- Decoder monitoring & output display]

    %% Backend Layer
    B[Backend: FastAPI + Socket.IO<br/>- WebSocket connections<br/>- Worker process management<br/>- Database operations<br/>- TLE data fetching<br/>- Recording & file management<br/>- Decoder lifecycle management]

    %% Worker Layer
    subgraph Workers["Worker Processes"]
        direction TB
        W1[Tracker Supervisor + Tracker Instances<br/>- One tracker instance per rotator<br/>- Antenna rotator control<br/>- Rig/radio control<br/>- Real-time tracking calculations<br/>- Hardware state management]
        W2[SDR IQ Acquisition<br/>- Raw IQ sample streaming<br/>- IQ Broadcaster pub/sub<br/>- Multi-consumer support]
        W2A[FFT Processor<br/>- Spectrum computation<br/>- Waterfall generation<br/>- Real-time FFT analysis]
        W2B[Demodulators<br/>- FM/SSB/AM modes<br/>- Normal & Internal modes<br/>- Frequency translation<br/>- Audio processing<br/>- Multi-VFO support]
        W2C[IQ Recorder<br/>- SigMF format recording<br/>- Metadata capture<br/>- Satellite info tagging<br/>- Waterfall snapshot saving]
        W2D[Decoders<br/>- SSTV image decoder ✓<br/>- AFSK packet decoder WIP<br/>- LoRa/GMSK decoders WIP<br/>- Audio Broadcaster for monitoring]
        W3[SDR Local Probe<br/>- Device discovery<br/>- Local SoapySDR enumeration<br/>- Hardware capability detection]
        W4[SDR Remote Probe<br/>- Remote SoapySDR discovery<br/>- Network device scanning<br/>- Remote capability detection]
    end

    %% Hardware Layer
    subgraph Hardware["Hardware Interfaces"]
        direction LR
        H1[Antenna Rotators<br/>- Hamlib compatible<br/>- Az/El control]
        H2[Radios/Rigs<br/>- CAT control<br/>- Frequency tuning]
        H3[Local SDR Devices<br/>- RTL-SDR<br/>- SoapySDR devices<br/>- UHD/USRP]
        H4[Remote SDR Devices<br/>- SoapyRemote<br/>- rtl_tcp servers<br/>- Network receivers]
        H5[SigMF Playback<br/>- Virtual SDR device<br/>- Recording playback<br/>- SigMF metadata reader]
    end

    %% Storage Layer
    subgraph Storage["Data Storage"]
        S1[SigMF Recordings<br/>- .sigmf-data files<br/>- .sigmf-meta files<br/>- Waterfall snapshots]
        S2[Decoded Outputs<br/>- SSTV images<br/>- Packet data]
    end

    %% External Services
    subgraph External["External Data Sources"]
        E1[TLE Data Sources<br/>- CelesTrak<br/>- SatNOGS DB]
        E2[Satellite Databases<br/>- Transmitter info<br/>- Orbital data]
    end

    %% Connections - Frontend to Backend
    A <---|Socket.IO<br/>Bidirectional| B

    %% Backend to Workers
    B ---|Message Queues<br/>Commands & Status| W1
    B ---|Message Queues<br/>Stream Control| W2
    B ---|Message Queues<br/>Discovery Requests| W3
    B ---|Message Queues<br/>Remote Scanning| W4

    %% SDR IQ Distribution via IQ Broadcaster
    W2 ---|IQ Broadcaster<br/>Subscribe| W2A
    W2 ---|IQ Broadcaster<br/>Subscribe| W2B
    W2 ---|IQ Broadcaster<br/>Subscribe| W2C
    W2 ---|IQ Broadcaster<br/>Subscribe Raw IQ| W2D

    %% Demodulator to Decoder Chain
    W2B ---|Internal Mode<br/>Audio Broadcaster| W2D

    %% Data back to Backend
    W2A ---|FFT Data<br/>Spectrum/Waterfall| B
    W2B ---|Audio Data<br/>Demodulated| B
    W2D ---|Decoded Data<br/>Images/Text/Packets| B
    W2D ---|UI Audio Stream<br/>Live Monitoring| B

    %% Recording Storage
    W2C ---|Write SigMF<br/>Recording Files| S1
    W2D ---|Write Decoded<br/>Output Files| S2

    %% Hardware Control
    W1 ---|Control Commands| H1
    W1 ---|Frequency Control| H2
    W2 ---|IQ Data Streaming| H3
    W2 ---|Network Streaming| H4
    W2 ---|Playback Source| H5
    W3 ---|Device Enumeration| H3
    W4 ---|Remote Discovery| H4

    %% Storage Access
    H5 ---|Read Files| S1
    B ---|File Management| S1
    B ---|File Management| S2

    %% External Data
    B ---|HTTP/API Requests| E1
    B ---|Database Queries| E2

    %% Dark Mode Styling
    classDef frontend fill:#1a237e,stroke:#3f51b5,stroke-width:2px,color:#ffffff
    classDef backend fill:#2e7d32,stroke:#4caf50,stroke-width:2px,color:#ffffff
    classDef worker fill:#e65100,stroke:#ff9800,stroke-width:2px,color:#ffffff
    classDef hardware fill:#4a148c,stroke:#9c27b0,stroke-width:2px,color:#ffffff
    classDef storage fill:#01579b,stroke:#0288d1,stroke-width:2px,color:#ffffff
    classDef external fill:#b71c1c,stroke:#f44336,stroke-width:2px,color:#ffffff

    class A frontend
    class B backend
    class W1,W2,W2A,W2B,W2C,W2D,W3,W4 worker
    class H1,H2,H3,H4,H5 hardware
    class S1,S2 storage
    class E1,E2 external

    %% Dashed borders for subgraphs
    style Workers stroke-dasharray: 5 5
    style Hardware stroke-dasharray: 5 5
    style Storage stroke-dasharray: 5 5
    style External stroke-dasharray: 5 5
```

### Signal Processing Data Flow

This diagram shows how radio signals flow through the system from SDR hardware to decoders and UI:

```mermaid
flowchart TB
    %% SDR Source
    SDR[SDR Hardware<br/>RTL-SDR, SoapySDR, UHD]

    %% IQ Broadcaster
    IQB[IQ Broadcaster<br/>Pub/Sub Pattern<br/>Deep copy for each subscriber]

    %% Primary Consumers
    subgraph Consumers["IQ Consumers"]
        FFT[FFT Processor<br/>→ Spectrum Display]
        REC[IQ Recorder<br/>→ SigMF Files]
        DEMOD[Demodulator<br/>FM/SSB/AM]
        IQDEC[IQ Decoders<br/>GMSK/FSK/BPSK]
    end

    %% Demodulator Branches
    subgraph DemodBranch["Demodulator Types"]
        direction TB
        NORM[Normal Mode<br/>User Playback]
        INT[Internal Mode<br/>For Decoders]
    end

    %% Audio Broadcaster for Internal Demodulators
    AUDIOB[Audio Broadcaster<br/>Pub/Sub Pattern<br/>Deep copy for each subscriber]

    %% Decoder Chain
    subgraph DecoderChain["Audio-based Decoder Processing"]
        direction TB
        DEC[Decoder<br/>AFSK]
        UIAUDIO[UI Audio Stream<br/>Live Monitoring]
    end

    %% Output Destinations
    subgraph Outputs["Outputs"]
        SPECUI[Spectrum/Waterfall UI]
        SIGFILE[SigMF Recording Files]
        PLAYBACK[Audio Playback to User]
        DECOUT[Decoded Data<br/>Images/Text/Packets]
        AUDIOUI[UI Audio Player<br/>Decoder Monitoring]
    end

    %% Connections
    SDR -->|Raw IQ Samples| IQB
    SDR -->|Raw IQ Samples| FFT
    IQB -->|Subscribe| REC
    IQB -->|Subscribe| DEMOD
    IQB -->|Subscribe| IQDEC

    DEMOD -->|Branch| NORM
    DEMOD -->|Branch| INT

    NORM -->|Audio Queue| PLAYBACK
    INT -->|Audio Queue| AUDIOB

    AUDIOB -->|Subscribe: decoder| DEC
    AUDIOB -->|Subscribe: ui| UIAUDIO

    FFT -->|FFT Data| SPECUI
    REC -->|Write| SIGFILE
    DEC -->|Decoded Output| DECOUT
    IQDEC -->|Decoded Output| DECOUT
    UIAUDIO -->|Audio Chunks| AUDIOUI

    %% Styling
    classDef hardware fill:#4a148c,stroke:#9c27b0,stroke-width:2px,color:#ffffff
    classDef broadcaster fill:#d84315,stroke:#ff5722,stroke-width:3px,color:#ffffff
    classDef processor fill:#e65100,stroke:#ff9800,stroke-width:2px,color:#ffffff
    classDef output fill:#01579b,stroke:#0288d1,stroke-width:2px,color:#ffffff
    classDef decoder fill:#1b5e20,stroke:#4caf50,stroke-width:2px,color:#ffffff

    class SDR hardware
    class IQB,AUDIOB broadcaster
    class FFT,REC,DEMOD,NORM,INT processor
    class SPECUI,SIGFILE,PLAYBACK,DECOUT,AUDIOUI output
    class DEC,UIAUDIO decoder
```

#### Key Concepts

**IQ Broadcaster (Pub/Sub Pattern):**
- SDR produces raw IQ samples at high rate
- IQBroadcaster distributes to multiple consumers simultaneously
- Each subscriber gets independent queue with deep-copied samples
- Slow consumers: messages dropped rather than blocking producer
- Supports: FFT processor, demodulators, IQ recorder, decoders (LoRa/GMSK)

**Audio Broadcaster (Decoder Pattern):**
- Only used for internal demodulators feeding decoders
- Distributes demodulated audio to:
  - **Decoder subscriber:** SSTV/AFSK decoder processing
  - **UI subscriber:** Live audio monitoring in browser
- Statistics tracking: delivered/dropped message counts per subscriber
- Graceful slow consumer handling

**Chain Processing Example (SSTV):**
1. SDR → IQBroadcaster → Internal FM Demodulator (SSTV)
2. FM Demodulator → AudioBroadcaster input queue
3. AudioBroadcaster → Decoder subscriber → SSTV Decoder → Image output
4. AudioBroadcaster → UI subscriber → Browser audio player

**Why Broadcasters?**
- **Decoupling:** Producers don't know about consumers
- **Scalability:** Add consumers without modifying producers
- **Monitoring:** Per-subscriber statistics and health monitoring
- **Reliability:** Slow consumers don't block fast producers

*   **Frontend:** The frontend is a single-page application built with React, Redux Toolkit, and Material-UI. It communicates with the backend using a socket.io connection for real-time updates, including decoded data display and live audio monitoring.
*   **Backend:** The backend is a Python application built with FastAPI. It provides a REST API and a socket.io interface for the frontend. It manages worker processes, decoder lifecycle, and coordinates the pub/sub architecture for signal distribution.
*   **Workers:** The worker processes are responsible for the heavy lifting. They perform tasks such as satellite tracking, SDR streaming, signal demodulation, data decoding (SSTV implemented, AFSK/LoRa in development), and antenna control. Workers use IQ Broadcaster and Audio Broadcaster for efficient multi-consumer signal distribution.

## Third-Party Libraries & Technologies

### Backend

*   **[FastAPI](https://fastapi.tiangolo.com/):** A modern, fast (high-performance), web framework for building APIs with Python 3.7+ based on standard Python type hints.
*   **[SQLAlchemy](https://www.sqlalchemy.org/):** The Python SQL Toolkit and Object Relational Mapper that gives application developers the full power and flexibility of SQL.
*   **[Skyfield](https://rhodesmill.org/skyfield/):** A modern astronomy library for Python that computes positions for the stars, planets, and satellites in orbit around the Earth.
*   **[NASA/JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html):** Ephemeris vectors and observer geometry for solar-system body tracking.
*   **[SGP4](https://pypi.org/project/sgp4/):** A Python implementation of the SGP4 satellite propagation model.
*   **[Socket.IO](https://python-socketio.readthedocs.io/en/latest/):** A library for real-time, bidirectional, event-based communication.
*   **[pyrtlsdr](https://pypi.org/project/pyrtlsdr/):** A Python wrapper for the RTL-SDR library.
*   **[SoapySDR](https://pypi.org/project/SoapySDR/):** A vendor and platform neutral SDR support library.
*   **[SatDump](https://github.com/SatDump/SatDump):** Satellite decoder suite used for weather image decoding workflows.
*   **[gr-satellites](https://github.com/daniestevez/gr-satellites):** GNU Radio out-of-tree modules for satellite communications decoding.

### Frontend

*   **[React](https://reactjs.org/):** A JavaScript library for building user interfaces.
*   **[Redux Toolkit](https://redux-toolkit.js.org/):** The official, opinionated, batteries-included toolset for efficient Redux development.
*   **[Material-UI](https://mui.com/):** A popular React UI framework with a comprehensive suite of UI tools.
*   **[Vite](https://vitejs.dev/):** A build tool that aims to provide a faster and leaner development experience for modern web projects.
*   **[Socket.IO Client](https://socket.io/docs/v4/client-api/):** The client-side library for Socket.IO.
*   **[Leaflet](https://leafletjs.com/):** An open-source JavaScript library for mobile-friendly interactive maps.
*   **[satellite.js](https://github.com/shashwatak/satellite-js):** A JavaScript library to propagate satellite orbits.

## SDR Device Support

Dedicated worker processes provide IQ acquisition, FFT processing, and demodulation support for multiple receiver families:

*   **RTL-SDR** (USB or `rtl_tcp`) workers
*   **SoapySDR** devices locally or through SoapyRemote: RTL-SDR, Airspy, AirspyHF+, HackRF, HydraSDR, LimeSDR, PlutoSDR, UHD/USRP, and SDRplay (RSP series)
*   **UHD/USRP** radios via a UHD worker
*   **Need another SoapySDR device?** Open a GitHub issue and request support.

The SDR architecture uses a pub/sub pattern (IQ Broadcaster) to separate IQ acquisition from signal processing:
*   **IQ Acquisition Workers** stream raw samples to **IQ Broadcaster**
*   **IQ Broadcaster** distributes to multiple subscribers independently:
    *   **FFT Processor** for spectrum/waterfall display
    *   **Demodulators** (FM/SSB/AM) for audio output in normal and internal modes
    *   **IQ Recorder** for SigMF format file capture
*   **Raw IQ Decoders** (BPSK, GMSK) that bypass demodulation
*   **Audio Broadcaster** distributes demodulated audio from internal demodulators to:
*   **Data Decoders** (AFSK) for signal decoding
    *   **UI Audio Stream** for live monitoring in browser

> **Note:** The signal processing components (demodulators, broadcasters, decoders) were developed with assistance from Claude AI (Anthropic) to handle complex DSP algorithms. These components are clearly marked in the source code and are licensed under GPL-3.0 like the rest of the project.

## IQ Recording & Playback

Ground Station includes comprehensive IQ recording and playback capabilities using the [SigMF (Signal Metadata Format)](https://github.com/gnuradio/SigMF) standard:

### Recording Features
*   **SigMF Format:** Records IQ data as `.sigmf-data` files with accompanying `.sigmf-meta` JSON metadata
*   **Automatic Metadata:** Captures center frequency, sample rate, timestamp, and recording duration
*   **Satellite Tracking:** Automatically tags recordings with target satellite name and NORAD ID
*   **Waterfall Snapshots:** Saves PNG snapshots of the waterfall display alongside recordings
*   **Multi-segment Support:** Handles parameter changes (frequency, sample rate) as separate capture segments
*   **Real-time Monitoring:** Live duration counter and visual recording indicator in the UI

### Playback Features
*   **Virtual SDR Device:** Recordings appear as "SigMF Playback" SDR in the device list
*   **Full Processing Pipeline:** Playback supports FFT display, demodulation, and all signal processing
*   **Live-equivalent Decoding:** During playback, demodulators and decoders run exactly as they do with live SDR input
*   **Recording Browser:** Sortable list of recordings with metadata preview (sample rate, duration, timestamp)
*   **Seamless Integration:** Switch between live SDR and playback without changing workflows

## Automated Observations

Ground Station includes an automated observation system for scheduled satellite passes:

*   **Monitored Satellites:** Define satellite monitoring templates with hardware configurations, signal parameters, and task definitions.
*   **Automated Pass Scheduling:** Automatically calculate and schedule upcoming passes based on configurable criteria (minimum elevation, lookahead window).
*   **Flexible Task Composition:** Combine IQ recording (SigMF), audio recording, protocol decoding, and AI transcription in a single observation.
*   **Hardware Orchestration:** Control SDR devices, antenna rotators (with satellite tracking), and rigs (with Doppler correction) during scheduled runs.
*   **Live Observation Capability:** Watch the spectrum waterfall, listen to demodulated audio, and view live decoder output during automated passes.
*   **Multi-SDR Observing:** Run automated observations on one SDR while additional SDRs record, decode, and listen to the same pass in parallel.
*   **Status Management:** Track observation status (scheduled, running, completed, failed, cancelled, missed) with automatic cleanup of old entries.
*   **Session Management:** Automated observations run in isolated internal VFO sessions (namespace: "internal:<observation_id>").

## Getting Started

For development setup, build steps, and testing, see `DEVELOPMENT.md`.

## Application Configuration

Ground Station backend runtime options are stored in `backend/data/configs/app_config.json` and are editable in the UI at `Settings -> Settings`.

Configuration precedence is:

1. CLI flags (highest priority)
2. `app_config.json`
3. built-in defaults (lowest priority)

The UI also exposes when a value is currently CLI-overridden and whether a change is hot-applied or restart-required.

`/settings/preferences` is kept as a compatibility route and is now rendered as a tab inside the unified Settings page.

## Docker

### Building from Source

The repository includes a multi-stage `Dockerfile` that builds the React frontend and a Python environment with SDR libraries.

```bash
docker build -t ground-station .

# Option 1: Standard bridge mode (works for local SDRs)
docker run --rm -p 7000:7000 --device /dev/bus/usb ground-station

# Option 2: Host networking (required for SoapySDR remote server discovery via mDNS)
docker run --rm --network host --device /dev/bus/usb ground-station
```

### Using Pre-built Docker Images

Pre-built multi-architecture Docker images are available for each release. For detailed instructions on using a specific release, see the [Releases page](https://github.com/sgoudelis/ground-station/releases).

### Pull the image

```bash
# Latest release tag (recommended)
docker pull ghcr.io/sgoudelis/ground-station:<version>

# Or pull architecture-specific tags directly
docker pull ghcr.io/sgoudelis/ground-station:<version>-amd64
docker pull ghcr.io/sgoudelis/ground-station:<version>-arm64
```

### Run the container

**Option 1: With SoapySDR Remote Server Discovery (Recommended)**

Uses host networking to enable automatic mDNS discovery of SoapySDR remote servers:

```bash
# AMD64
docker run -d \
  --platform linux/amd64 \
  --network host \
  --name ground-station \
  --restart unless-stopped \
  --device=/dev/bus/usb \
  --privileged \
  -v /path/to/data:/app/backend/data \
  ghcr.io/sgoudelis/ground-station:<version>

# ARM64 (Raspberry Pi, etc)
docker run -d \
  --platform linux/arm64 \
  --network host \
  --name ground-station \
  --restart unless-stopped \
  -v /dev:/dev \
  --privileged \
  -v /path/to/data:/app/backend/data \
  ghcr.io/sgoudelis/ground-station:<version>
```

**Option 2: Standard Bridge Mode (No SoapySDR Remote Discovery)**

Uses standard bridge networking with port mapping:

```bash
# AMD64
docker run -d \
  --platform linux/amd64 \
  -p 7000:7000 \
  --name ground-station \
  --restart unless-stopped \
  --device=/dev/bus/usb \
  --privileged \
  -v /path/to/data:/app/backend/data \
  ghcr.io/sgoudelis/ground-station:<version>

# ARM64 (Raspberry Pi, etc)
docker run -d \
  --platform linux/arm64 \
  -p 7000:7000 \
  --name ground-station \
  --restart unless-stopped \
  -v /dev:/dev \
  --privileged \
  -v /path/to/data:/app/backend/data \
  ghcr.io/sgoudelis/ground-station:<version>
```

**Important Notes:**
- Replace `/path/to/data` with your desired data directory path
- Option 1 (host networking) is required for automatic discovery of SoapySDR remote servers via mDNS
- Option 2 works for local SDRs and all other features
- For Raspberry Pi hardware, only the Raspberry Pi 5 is recommended
- For ARM64, using `-v /dev:/dev` ensures all USB devices are accessible
- Access the web interface at `http://<YOUR_HOST>:7000`

## Contributing

We welcome contributions! Please see the [CONTRIBUTING.md](CONTRIBUTING.md) file for details on how to get started.

## Acknowledgments

This project uses the SatNOGS API for transmitter information.

## License

This project is licensed under the GNU GPL v3. See the [LICENSE](LICENSE) file for details.



![](https://hit.yhype.me/github/profile?account_id=4840328)
![Visitors](https://api.visitorbadge.io/api/visitors?path=https%3A%2F%2Fgithub.com%2Fsgoudelis%2Fground-station&countColor=%23263759)
