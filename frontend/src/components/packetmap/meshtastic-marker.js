/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import pin from './icons/meshtastic-shadow.png';

export const meshtasticPinSize = [28, 36.5];
const shadowPadding = 20;
const labelHeight = 16;
const labelFont = '500 10px "Helvetica Neue", Arial, Helvetica, sans-serif';

// Keep thousands of ground nodes on one canvas, with one shared sprite and
// cached label metrics. MapLibre supplies projection and camera/render events.
export function createMeshtasticRenderer() {
    return new MeshtasticRenderer();
}

class MeshtasticRenderer {
    constructor() {
        this.markers = new Set();
        this.image = new Image();
        this.image.onload = () => this.map?.triggerRepaint();
        this.image.src = pin;
        this.draw = this.draw.bind(this);
        this.click = this.click.bind(this);
    }

    add(marker, map) {
        if (!this.map) {
            this.map = map;
            this.canvas = document.createElement('canvas');
            this.canvas.setAttribute('aria-hidden', 'true');
            Object.assign(this.canvas.style, {position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '2'});
            map.getContainer().appendChild(this.canvas);
            this.context = this.canvas.getContext('2d');
            map.on('render', this.draw);
            map.on('click', this.click);
        }
        this.markers.add(marker);
        map.triggerRepaint();
    }

    remove(marker) {
        this.markers.delete(marker);
        if (this.markers.size) {
            this.map.triggerRepaint();
            return;
        }
        // A late sprite load must never redraw a disposed map.
        this.map.off('render', this.draw);
        this.map.off('click', this.click);
        this.canvas.remove();
        this.map = null;
    }

    draw() {
        const map = this.map;
        if (!map || !this.context) return;
        const {width, height} = map.getContainer().getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
            this.canvas.width = Math.round(width * ratio);
            this.canvas.height = Math.round(height * ratio);
            this.canvas.style.width = `${width}px`;
            this.canvas.style.height = `${height}px`;
        }
        const context = this.context;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        context.font = labelFont;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        const [pinWidth, pinHeight] = meshtasticPinSize;
        for (const marker of this.markers) {
            const point = map.project([marker.longitude, marker.latitude]);
            marker.point = point;
            const labelGap = marker.selected ? 16 : 4;
            const label = String(marker.name ?? '');
            if (marker.measuredLabel !== label) {
                marker.labelWidth = Math.ceil(context.measureText(label).width) + 8;
                marker.measuredLabel = label;
            }
            const extent = Math.max(pinWidth + shadowPadding * 2, marker.labelWidth) / 2;
            if (point.x + extent < 0 || point.x - extent > width || point.y + shadowPadding < 0
                || point.y - pinHeight - labelGap - labelHeight > height) continue;
            if (this.image.complete && this.image.naturalWidth) {
                context.drawImage(this.image, point.x - pinWidth / 2 - shadowPadding,
                    point.y - pinHeight - shadowPadding, pinWidth + shadowPadding * 2, pinHeight + shadowPadding * 2);
            } else {
                context.fillStyle = '#66bb6a';
                context.beginPath();
                context.arc(point.x, point.y, 5.985, 0, Math.PI * 2);
                context.fill();
            }
            if (!label) continue;
            const x = point.x - marker.labelWidth / 2;
            const y = point.y - pinHeight - labelGap - labelHeight;
            context.fillStyle = 'rgba(18, 25, 30, 0.65)';
            context.beginPath();
            if (context.roundRect) context.roundRect(x, y, marker.labelWidth, labelHeight, 3);
            else context.rect(x, y, marker.labelWidth, labelHeight);
            context.fill();
            context.fillStyle = '#f5f5f5';
            context.fillText(label, point.x, y + labelHeight / 2);
        }
    }

    click(event) {
        // DOM aircraft and balloon markers own their clicks; labels and shadows
        // on this canvas never intercept navigation or another marker's selection.
        if (event.originalEvent?.target?.closest?.('.maplibregl-marker')) return;
        const [width, height] = meshtasticPinSize;
        for (const marker of [...this.markers].reverse()) {
            const point = marker.point;
            if (point && Math.abs(event.point.x - point.x) <= width / 2
                && event.point.y >= point.y - height && event.point.y <= point.y) {
                marker.onSelect?.();
                return;
            }
        }
    }
}
