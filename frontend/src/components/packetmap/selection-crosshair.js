/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

// Share the aircraft reticle's exact geometry with selected ground nodes.
export const selectionCrosshair = `<svg class="packet-selection-crosshair" viewBox="0 0 52 52" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1">
    <rect x="6" y="6" width="40" height="40" />
    <path d="M26 1V11 M26 41V51 M1 26H11 M41 26H51" />
</svg>`;

export const aircraftSelectionCrosshair = selectionCrosshair.replace('packet-selection-crosshair', 'packet-aircraft-crosshair');
