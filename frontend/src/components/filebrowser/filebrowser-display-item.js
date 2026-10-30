export function getFileBrowserDateField(sortBy) {
    return ['modified', 'completed_at'].includes(sortBy) ? sortBy : 'captured_at';
}

export function getFileBrowserDate(item, sortBy) {
    const field = getFileBrowserDateField(sortBy);
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
