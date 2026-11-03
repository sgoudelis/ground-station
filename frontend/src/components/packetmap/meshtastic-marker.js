/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {Bounds, Canvas, CircleMarker} from 'leaflet';
import pin from './icons/meshtastic-shadow.png';

export const meshtasticPinSize = [28, 36.5];
const shadowPadding = 20;
const labelHeight = 16;
const labelFont = '500 10px "Helvetica Neue", Arial, Helvetica, sans-serif';

// Leaflet's canvas renderer owns redraw batching, clipping and pointer events.
// Extend its circle drawing hook so thousands of pins share one image and canvas.
class MeshtasticRenderer extends Canvas {
    initialize(options) {
        super.initialize(options);
        this._pin = new Image();
        this._pin.onload = () => {
            // Loading may finish after the map was unmounted.
            if (!this._map) return;
            // Use Leaflet's pending frame so removal can still cancel the redraw.
            for (const layer of Object.values(this._layers)) this._requestRedraw(layer);
        };
        this._pin.src = pin;
    }

    _updateCircle(layer) {
        if (!this._drawing || layer._empty()) return;
        const [width, height] = meshtasticPinSize;
        const context = this._ctx;
        if (!this._pin.complete || !this._pin.naturalWidth) {
            // Keep nodes visible while the local asset loads or if it fails.
            super._updateCircle(layer);
        } else {
            // Shadows are baked once into the shared sprite, never blurred per node/frame.
            context.globalAlpha = 1;
            context.drawImage(this._pin, layer._point.x - width / 2 - shadowPadding,
                layer._point.y - height - shadowPadding, width + shadowPadding * 2, height + shadowPadding * 2);
        }
        if (!layer.options.label) return;
        const x = layer._point.x - layer._labelWidth / 2;
        const y = layer._point.y - height - layer._labelGap - labelHeight;
        context.globalAlpha = 1;
        context.fillStyle = 'rgba(18, 25, 30, 0.65)';
        context.beginPath();
        if (context.roundRect) context.roundRect(x, y, layer._labelWidth, labelHeight, 3);
        else context.rect(x, y, layer._labelWidth, labelHeight);
        context.fill();
        context.font = labelFont;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = '#f5f5f5';
        context.fillText(layer.options.label, layer._point.x, y + labelHeight / 2);
    }
}

export function createMeshtasticRenderer() {
    return new MeshtasticRenderer();
}

export class MeshtasticMarker extends CircleMarker {
    setLabel(label, selected) {
        const text = String(label ?? '');
        if (this.options.label === text && this.options.selected === selected) return this;
        this.options.label = text;
        this.options.selected = selected;
        return this.redraw();
    }

    _updateBounds() {
        const [width, height] = meshtasticPinSize;
        this._pinBounds = new Bounds(this._point.subtract([width / 2, height]), this._point.add([width / 2, 0]));
        // Clearing must include the shadow and label's old extent when a node moves or is renamed.
        this._pxBounds = new Bounds(this._pinBounds.min.subtract([shadowPadding, shadowPadding]),
            this._pinBounds.max.add([shadowPadding, shadowPadding]));
        this._labelGap = this.options.selected ? 16 : 4;
        if (this.options.label) {
            // Cache text metrics; live playback and selection do not remeasure names.
            if (this._measuredLabel !== this.options.label) {
                this._renderer._ctx.font = labelFont;
                this._labelWidth = Math.ceil(this._renderer._ctx.measureText(this.options.label).width) + 8;
                this._measuredLabel = this.options.label;
            }
            this._pxBounds.extend(this._point.subtract([this._labelWidth / 2, height + this._labelGap + labelHeight]));
            this._pxBounds.extend(this._point.add([this._labelWidth / 2, -height - this._labelGap]));
        }
    }

    _containsPoint(point) {
        // Canvas hit testing must follow the pin, rather than a circle at its tip.
        return this._pinBounds.contains(point);
    }
}
