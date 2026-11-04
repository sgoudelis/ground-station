/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

// Marker artwork is independent of the map engine. MapLibre owns positioning;
// these elements only own the symbol, label and optional ground shadow.
export class MarkerArtwork {
    constructor(options) {
        this.options = options;
    }

    styleElement(element, kind) {
        const [width, height] = this.options[`${kind}Size`] || this.options.iconSize;
        element.className = this.options.className;
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
    }

    createIcon(previous) {
        const element = previous || document.createElement('div');
        element.innerHTML = this.options.html;
        this.styleElement(element, 'icon');
        return element;
    }

    createShadow(previous) {
        if (!this.options.shadowHtml) return null;
        const element = previous || document.createElement('div');
        element.innerHTML = this.options.shadowHtml;
        element.setAttribute('aria-hidden', 'true');
        this.styleElement(element, 'shadow');
        return element;
    }
}
