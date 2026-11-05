export function getFileBrowserDateField(sortBy) {
    return ['latest_activity', 'modified', 'completed_at'].includes(sortBy) ? sortBy : 'captured_at';
}

export function getDecodedFolderDescription(item) {
    if (item.folder_kind === 'aprs') return `${item.packet_count || 0} packets · ${item.run_count || 0} runs · ${item.source_callsign}`;
    if (item.folder_kind === 'meshtastic') return `${item.packet_count || 0} packets · ${item.run_count || 0} runs · ${item.node_id}`;
    if (item.folder_kind === 'adsb') return `${item.packet_count || 0} states · ${item.run_count || 0} runs${item.callsign ? ` · ${item.callsign}` : ''}`;
    if (item.folder_kind === 'radiosonde') {
        return `${item.packet_count || 0} packets · ${item.run_count || 0} flights`;
    }
    if (item.folder_kind === 'observation') {
        return `${item.artifact_count || 0} files - ${item.observation_in_progress ? 'Observation in progress' : 'Automated observation'}`;
    }
    return `${item.image_count || 0} images - ${item.pipeline || 'SatDump output'}`;
}

export function getFileBrowserDate(item, sortBy) {
    const field = getFileBrowserDateField(sortBy);
    // Keep this fallback in sync with inventory sorting for legacy summaries.
    if (field === 'latest_activity') return item.latest_activity || item.modified || item.captured_at || item.created || null;
    // Older payloads may not include capture metadata yet. Their content mtime
    // is a better approximation than Linux ctime. Completion stays unknown.
    return field === 'captured_at'
        ? item.captured_at || item.modified || item.created || null
        : item[field] || null;
}

export function isFileBrowserDateApproximate(item, sortBy) {
    return getFileBrowserDateField(sortBy) === 'captured_at'
        && (!item.captured_at || item.captured_at_source === 'filesystem');
}

export function getFileBrowserSource(item) {
    const joinIdentity = (...parts) => [...new Set(parts.filter(Boolean))].join(' · ');
    if (item.folder_kind === 'adsb') {
        return joinIdentity(item.aircraft?.registration, item.callsign, item.icao?.toUpperCase());
    }
    if (item.folder_kind === 'meshtastic') {
        return joinIdentity(item.long_name || item.short_name, item.node_id);
    }
    if (item.folder_kind === 'radiosonde') {
        return item.serial || '';
    }
    // Callsigns describe terrestrial stations too; older APRS payloads sometimes
    // put the callsign in satellite_name, so prefer the explicit source identity.
    if (item.source_callsign) return item.source_callsign;
    const norad = item.satellite_norad_id || item.metadata?.target_satellite_norad_id;
    const satellite = item.satellite_name || item.metadata?.target_satellite_name;
    const isAprs = String(item.decoder_type || item.folder_kind || '').toLowerCase() === 'aprs';
    if (isAprs && !norad) return '';
    return satellite || (norad ? `NORAD ${norad}` : '');
}

export function getFileBrowserSummary(item, t) {
    const countLabel = (key, count) => t(`file_table_view.${key}`, {count: count ?? 0});
    if (item.type === 'decoded_folder') {
        if (['aprs', 'meshtastic', 'radiosonde', 'adsb'].includes(item.folder_kind)) {
            return [
                countLabel(item.folder_kind === 'adsb' ? 'updates' : 'packets', item.packet_count),
                countLabel(item.folder_kind === 'radiosonde' ? 'flights' : 'runs', item.run_count),
            ].join(' · ');
        }
        return item.folder_kind === 'observation'
            ? countLabel('files', item.artifact_count)
            : countLabel('images', item.image_count);
    }
    if (item.type === 'recording' && item.duration) return item.duration;
    const seconds = item.duration_seconds ?? item.metadata?.duration_seconds;
    if (seconds != null && Number.isFinite(Number(seconds)) && Number(seconds) >= 0) {
        const total = Math.floor(Number(seconds));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const remainder = String(total % 60).padStart(2, '0');
        return hours
            ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
            : `${minutes}:${remainder}`;
    }
    if (item.width && item.height) return `${item.width} × ${item.height}`;
    return '';
}

export function buildFileBrowserDisplayItem(item, formatDurationFn) {
    const isRecording = item.type === 'recording';
    const duration = isRecording && item.metadata?.start_time
        ? formatDurationFn(item.metadata.start_time, item.metadata.finalized_time)
        : null;

    const isDecodedImage = item.type === 'decoded' && item.file_type &&
        ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(item.file_type.toLowerCase());

    const isAudioRecording = item.type === 'audio';
    const audioRecordingInProgress = isAudioRecording && item.status === 'recording';

    let image = null;
    if (item.type === 'recording') {
        image = item.recording_in_progress
            ? null
            : item.snapshot?.thumbnail_url || item.snapshot?.url;
    } else if (item.type === 'decoded_folder') {
        image = item.thumbnail_url || null;
    } else if (item.type === 'snapshot' || isDecodedImage) {
        image = item.type === 'snapshot' ? item.thumbnail_url || item.url : item.url;
    }

    return {
        ...item,
        displayName: item.name || item.filename || item.foldername,
        image,
        duration,
        audioRecordingInProgress,
    };
}
