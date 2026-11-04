/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

// Keep browsing and purge choices aligned as new capture types are added.
export const FILE_TYPES = [
    { key: 'showRecordings', itemType: 'recording', label: 'filters.recordings', fallback: 'Recordings' },
    { key: 'showSnapshots', itemType: 'snapshot', label: 'filters.snapshots', fallback: 'Snapshots' },
    { key: 'showDecoded', itemType: 'decoded', label: 'filters.decoded', fallback: 'Decoded' },
    { key: 'showObservations', itemType: 'observation', label: 'filters.observations', fallback: 'Observations' },
    { key: 'showRadiosondes', itemType: 'radiosonde', label: 'filters.weather_balloons', fallback: 'Weather balloons' },
    { key: 'showAircraft', itemType: 'adsb', label: 'filters.aircraft', fallback: 'Aircraft' },
    { key: 'showMeshtastic', itemType: 'meshtastic', label: 'filters.meshtastic_nodes', fallback: 'Meshtastic nodes' },
    { key: 'showAudio', itemType: 'audio', label: 'filters.audio', fallback: 'Audio' },
    { key: 'showTranscriptions', itemType: 'transcription', label: 'filters.transcriptions', fallback: 'Transcriptions' },
];
