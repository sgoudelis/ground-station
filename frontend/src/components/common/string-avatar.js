/**
 * Avatar helpers kept free of map/leaflet imports so the dashboard shell can
 * use them without pulling the map stack into the initial bundle.
 */

export function stringToColor(string) {
    let hash = 0;
    let i;

    for (i = 0; i < string.length; i += 1) {
        hash = string.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (i = 0; i < 3; i += 1) {
        const value = (hash >> (i * 8)) & 0xff;
        color += `00${value.toString(16)}`.slice(-2);
    }

    return color;
}

export function stringAvatar(name) {
    const normalizedName = String(name || '').trim();
    const nameParts = normalizedName.split(/\s+/).filter(Boolean);
    const firstInitial = nameParts[0]?.[0] || '?';
    const secondInitial = nameParts[1]?.[0] || firstInitial;

    return {
        sx: {
            bgcolor: stringToColor(normalizedName || 'unknown-user'),
        },
        children: `${firstInitial}${secondInitial}`.toUpperCase(),
    };
}
