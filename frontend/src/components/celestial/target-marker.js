const CROSSHAIR_SIZE = 30;
const CROSSHAIR_CENTER_GAP = 8;
const LABEL_HEIGHT = 23;
const LABEL_PADDING = 6;
const BADGE_HEIGHT = 15;
const BADGE_PADDING = 3.6;
const CONTENT_GAP = 3.2;
const EDGE_PADDING = 4;
const POINTER_SIZE = 6;

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x
    && a.y < b.y + b.h && a.y + a.h > b.y;

export const isTargetOnScreen = (x, y, width, height) => (
    Number.isFinite(x) && Number.isFinite(y)
    && x >= 0 && x <= width && y >= 0 && y <= height
);

export const drawTargetCrosshair = (ctx, x, y, width, height, color) => {
    if (!isTargetOnScreen(x, y, width, height)) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    // Leave space around the target marker at the center of the square.
    ctx.moveTo(0, y);
    ctx.lineTo(Math.max(0, x - CROSSHAIR_CENTER_GAP), y);
    ctx.moveTo(Math.min(width, x + CROSSHAIR_CENTER_GAP), y);
    ctx.lineTo(width, y);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, Math.max(0, y - CROSSHAIR_CENTER_GAP));
    ctx.moveTo(x, Math.min(height, y + CROSSHAIR_CENTER_GAP));
    ctx.lineTo(x, height);
    ctx.stroke();

    // Keep the frame at a fixed screen size while the world coordinates zoom.
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - CROSSHAIR_SIZE / 2, y - CROSSHAIR_SIZE / 2, CROSSHAIR_SIZE, CROSSHAIR_SIZE);
    ctx.restore();
};

export const createTargetLabel = (ctx, { x, y, width, height, name, targetNumber, fontFamily, occupiedBoxes }) => {
    if (!isTargetOnScreen(x, y, width, height)) return null;

    ctx.save();
    const badgeText = `T${Math.round(targetNumber)}`;
    ctx.font = `900 11px ${fontFamily}`;
    const badgeWidth = Math.max(16, Math.ceil(ctx.measureText(badgeText).width) + BADGE_PADDING * 2);
    const maxWidth = Math.min(192, width - EDGE_PADDING * 2);
    const maxNameWidth = Math.max(0, maxWidth - LABEL_PADDING * 2 - badgeWidth - CONTENT_GAP);
    ctx.font = `700 12px ${fontFamily}`;
    let nameText = String(name);
    if (ctx.measureText(nameText).width > maxNameWidth) {
        // Bound long mission names without scaling the target badge or font.
        while (nameText && ctx.measureText(`${nameText}…`).width > maxNameWidth) {
            nameText = nameText.slice(0, -1);
        }
        nameText = nameText ? `${nameText}…` : '';
    }
    const labelWidth = LABEL_PADDING * 2 + badgeWidth
        + (nameText ? CONTENT_GAP + ctx.measureText(nameText).width : 0);
    ctx.restore();

    const anchorGap = CROSSHAIR_SIZE / 2 + POINTER_SIZE;
    const candidates = [
        { x: x + anchorGap, y: y - LABEL_HEIGHT / 2, side: 'right' },
        { x: x - anchorGap - labelWidth, y: y - LABEL_HEIGHT / 2, side: 'left' },
        { x: x - labelWidth / 2, y: y - anchorGap - LABEL_HEIGHT, side: 'top' },
        { x: x - labelWidth / 2, y: y + anchorGap, side: 'bottom' },
    ].map((candidate) => ({
        ...candidate,
        x: clamp(candidate.x, EDGE_PADDING, width - EDGE_PADDING - labelWidth),
        y: clamp(candidate.y, EDGE_PADDING, height - EDGE_PADDING - LABEL_HEIGHT),
        w: labelWidth,
        h: LABEL_HEIGHT,
    }));
    // Prefer a clear label beside the target, then try the opposite side or above/below.
    const box = candidates.find((candidate) => !occupiedBoxes.some((occupied) => overlaps(candidate, occupied)))
        || candidates[0];

    return {
        ...box,
        anchorX: x,
        anchorY: y,
        badgeText,
        badgeWidth,
        nameText,
        fontFamily,
    };
};

export const drawTargetLabel = (ctx, label, theme) => {
    const { x, y, w, h, side, anchorX, anchorY, badgeText, badgeWidth, nameText, fontFamily } = label;
    const badgePalette = theme.palette.badge?.targetSlot || {};
    ctx.save();
    ctx.fillStyle = theme.palette.error.dark;
    ctx.strokeStyle = theme.palette.error.main;
    ctx.lineWidth = 1;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(theme.shape.borderRadius, h / 2));
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.stroke();

    // Match the Earth map tooltip pointer while allowing the box to shift at edges.
    ctx.beginPath();
    if (side === 'right' || side === 'left') {
        const pointerY = clamp(anchorY, y + POINTER_SIZE, y + h - POINTER_SIZE);
        const edgeX = side === 'right' ? x : x + w;
        const tipX = edgeX + (side === 'right' ? -POINTER_SIZE : POINTER_SIZE);
        ctx.moveTo(edgeX, pointerY - POINTER_SIZE);
        ctx.lineTo(tipX, pointerY);
        ctx.lineTo(edgeX, pointerY + POINTER_SIZE);
    } else {
        const pointerX = clamp(anchorX, x + POINTER_SIZE, x + w - POINTER_SIZE);
        const edgeY = side === 'top' ? y + h : y;
        const tipY = edgeY + (side === 'top' ? POINTER_SIZE : -POINTER_SIZE);
        ctx.moveTo(pointerX - POINTER_SIZE, edgeY);
        ctx.lineTo(pointerX, tipY);
        ctx.lineTo(pointerX + POINTER_SIZE, edgeY);
    }
    ctx.fill();
    ctx.stroke();

    const badgeX = x + LABEL_PADDING;
    const centerY = y + h / 2;
    ctx.beginPath();
    ctx.roundRect(badgeX, centerY - BADGE_HEIGHT / 2, badgeWidth, BADGE_HEIGHT, 3);
    ctx.fillStyle = badgePalette.background || theme.palette.warning.main;
    ctx.fill();
    ctx.font = `900 11px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = badgePalette.text || theme.palette.common.black;
    ctx.fillText(badgeText, badgeX + badgeWidth / 2, centerY + 0.35);

    ctx.font = `700 12px ${fontFamily}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.palette.getContrastText(theme.palette.error.dark);
    ctx.fillText(nameText, badgeX + badgeWidth + CONTENT_GAP, centerY + 0.35);
    ctx.restore();
};
