const encodeAssetPath = (path) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/');

export const resolveDecodedAssetUrl = (filepath, fallbackFilename) => {
    const normalized = typeof filepath === 'string'
        ? `/${filepath.replace(/\\/g, '/').replace(/^\/+/, '')}` : '';
    for (const mount of ['observations', 'decoded']) {
        const marker = `/data/${mount}/`;
        const index = normalized.lastIndexOf(marker);
        if (index !== -1) return `/${mount}/${encodeAssetPath(normalized.slice(index + marker.length))}`;
    }
    return fallbackFilename ? `/decoded/${encodeAssetPath(fallbackFilename)}` : null;
};
