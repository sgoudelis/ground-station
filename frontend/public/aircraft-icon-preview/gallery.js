/* Ground Station icon preview. GPL-3.0-or-later. Artwork licenses: see NOTICE.md. */
(() => {
    const {shapes, supplemental} = window.aircraftPreviewData;
    const labels = {
        a319: 'Airbus A319', a320: 'Airbus A320', a321: 'Airbus A321',
        p8: 'Boeing P-8 Poseidon', e737: 'Boeing E-7 Wedgetail',
        b737: 'Boeing 737-700', b738: 'Boeing 737-800', b739: 'Boeing 737-900',
        airliner: 'Generic airliner', blimp: 'Blimp / airship', balloon: 'Balloon',
        cessna: 'Single-engine propeller', a359: 'Airbus A350-900', a332: 'Airbus A330-200',
        heavy_2e: 'Heavy twin-engine jet', md11: 'McDonnell Douglas MD-11', c130: 'Lockheed C-130 Hercules',
        hi_perf: 'High-performance jet / F-16', f18: 'F/A-18 Hornet', e3awacs: 'Boeing E-3 AWACS',
        heavy_4e: 'Heavy four-engine jet', single_turbo: 'Single-engine turboprop',
        jet_nonswept: 'Straight-wing jet', jet_swept: 'Swept-wing jet',
        twin_large: 'Large twin-engine propeller', twin_small: 'Small twin-engine propeller',
        alpha_jet: 'Dassault / Dornier Alpha Jet', a225: 'Antonov An-225', a400: 'Airbus A400M',
        v22_slow: 'V-22 Osprey · hover', v22_fast: 'V-22 Osprey · cruise',
        t38: 'Northrop T-38 Talon', f35: 'Lockheed Martin F-35', l159: 'Aero L-159',
        mirage: 'Dassault Mirage', sb39: 'Saab JAS 39 Gripen', md_a4: 'A-4 Skyhawk',
        tornado: 'Panavia Tornado', uav: 'Unmanned aircraft', typhoon: 'Eurofighter Typhoon',
        rafale: 'Dassault Rafale', hunter: 'Hawker Hunter', lancaster: 'Avro Lancaster',
        beluga: 'Airbus Beluga', c17: 'Boeing C-17 Globemaster III', c5: 'Lockheed C-5 Galaxy',
        super_guppy: 'Aero Spacelines Super Guppy', wb57: 'NASA WB-57', a380: 'Airbus A380',
        il_62: 'Ilyushin Il-62', u2: 'Lockheed U-2', glider: 'Glider / sailplane',
        p3_orion: 'Lockheed P-3 Orion', cirrus_sr22: 'Cirrus SR22', verhees: 'Verhees Delta',
        gyrocopter: 'Gyroplane', helicopter: 'Generic helicopter', pa24: 'Piper PA-24 Comanche',
        bae_hawk: 'BAE Hawk', a10: 'Fairchild A-10 Thunderbolt II', chinook: 'CH-47 Chinook',
        apache: 'AH-64 Apache', blackhawk: 'UH-60 Black Hawk', s61: 'Sikorsky S-61',
        f5_tiger: 'Northrop F-5 Tiger', c2: 'Grumman C-2 Greyhound', b52: 'Boeing B-52',
        b707: 'Boeing 707', rutan_veze: 'Rutan VariEze', pumpkin: 'Flying pumpkin',
        witchr: 'Witch · right', witchl: 'Witch · left', m326: 'EMB-326 / MB-339',
        miragef1: 'Dassault Mirage F1', unknown: 'Unknown marker', ground_square: 'Ground square',
        ground_emergency: 'Emergency vehicle', ground_service: 'Service vehicle',
        ground_unknown: 'Unknown ground vehicle', ground_fixed: 'Fixed ground position', ground_tower: 'Tower',
        puma: 'Puma / Super Puma', tiger: 'Eurocopter Tiger', mil24: 'Mil Mi-24',
        dauphin: 'SA365 Dauphin', gazelle: 'Gazelle / Ecureuil', md_f15: 'F-15 Eagle',
        strato: 'Stratolaunch', asterisk: 'Asterisk marker', b1b_lancer: 'Rockwell B-1B Lancer',
        para: 'Paraglider canopy', e390: 'Embraer C-390 Millennium',
    };
    const groups = {
        'Airliners': 'a319 a320 a321 b737 b738 b739 airliner a359 a332 heavy_2e md11 heavy_4e a380 il_62 b707',
        'Propeller aircraft': 'cessna single_turbo twin_large twin_small cirrus_sr22 verhees pa24 rutan_veze',
        'Jets': 'jet_nonswept jet_swept',
        'Military jets': 'hi_perf f18 alpha_jet t38 f35 l159 mirage sb39 md_a4 tornado typhoon rafale hunter bae_hawk a10 f5_tiger m326 miragef1 md_f15 b52 b1b_lancer',
        'Cargo & special aircraft': 'p8 e737 e3awacs c130 a225 a400 lancaster beluga c17 c5 super_guppy wb57 u2 p3_orion c2 strato e390',
        'Rotorcraft': 'v22_slow v22_fast gyrocopter helicopter chinook apache blackhawk s61 puma tiger mil24 dauphin gazelle',
        'Gliders': 'glider',
        'Balloons & airships': 'blimp balloon',
        'Unmanned aircraft': 'uav',
        'Paragliders': 'para',
        'Ground & utility': 'unknown ground_square ground_emergency ground_service ground_unknown ground_fixed ground_tower asterisk',
        'Novelty': 'pumpkin witchr witchl',
    };
    const groupByKey = new Map(Object.entries(groups).flatMap(([group, keys]) => keys.split(' ').map(key => [key, group])));
    const aviation = group => group !== 'Ground & utility' && group !== 'Novelty';
    const icons = Object.entries(shapes).map(([key, shape]) => ({
        key, shape, name: labels[key] || key, group: groupByKey.get(key) || 'Aircraft', source: 'tar1090',
        aviation: aviation(groupByKey.get(key)), noRotate: Boolean(shape.noRotate),
        license: key === 'c130' ? 'CC BY 4.0 · Peter Lowden' : 'GPL-2.0-or-later',
    }));
    supplemental.forEach(({name, svg}) => icons.push({
        key: `tabler-${name}`, name: `${name[0].toUpperCase()}${name.slice(1)} · outline`,
        svg, group: 'Supplementary', source: 'Tabler', aviation: false, noRotate: true, license: 'MIT · Paweł Kuna',
    }));
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const gallery = document.getElementById('gallery');
    const detail = document.getElementById('detail');
    let downloadUrl = null;

    function svgElement(tag, attributes) {
        const element = document.createElementNS(svgNamespace, tag);
        Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
        return element;
    }

    function artwork(icon) {
        if (icon.svg) return new DOMParser().parseFromString(icon.svg, 'image/svg+xml').documentElement;
        const shape = icon.shape;
        if (shape.svg) {
            const source = shape.svg.replaceAll('SIZE', `width="${shape.w}" height="${shape.h}"`)
                .replaceAll('fillColor', '#66bb6a').replaceAll('strokeColor', '#17211a')
                .replaceAll('strokeWidth', 0.65 * (shape.strokeScale || 1));
            const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
            // Inline the source's simple class rules so one SVG cannot restyle another.
            for (const style of svg.querySelectorAll('style')) {
                for (const rule of style.textContent.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
                    for (const element of svg.querySelectorAll(rule[1].trim())) element.setAttribute('style', rule[2]);
                }
                style.remove();
            }
            for (const element of svg.querySelectorAll('[id]')) element.removeAttribute('id');
            return svg;
        }
        const svg = svgElement('svg', {xmlns: svgNamespace, viewBox: shape.viewBox, width: shape.w, height: shape.h, 'aria-hidden': 'true'});
        if (shape.noAspect) svg.setAttribute('preserveAspectRatio', 'none');
        const group = svgElement('g', shape.transform ? {transform: shape.transform} : {});
        const width = 0.65 * (shape.strokeScale || 1);
        // Preserve upstream accents, aspect ratios and stroke scales at map size.
        for (const path of shape.path ? [shape.path].flat() : []) {
            group.append(svgElement('path', {d: path, fill: 'var(--aircraft, #66bb6a)', stroke: 'var(--outline, #17211a)', 'stroke-width': width * 2, 'paint-order': 'stroke'}));
        }
        for (const path of shape.accent ? [shape.accent].flat() : []) {
            group.append(svgElement('path', {d: path, fill: 'none', stroke: 'var(--outline, #17211a)', 'stroke-width': width * 0.6 * (shape.accentMult || 1)}));
        }
        svg.append(group);
        return svg;
    }

    function marker(icon) {
        const marker = document.createElement('span');
        marker.className = `marker${icon.noRotate ? ' no-rotate' : ''}`;
        marker.setAttribute('aria-hidden', 'true');
        const width = icon.shape?.w || 24;
        const height = icon.shape?.h || 24;
        marker.style.setProperty('--width-ratio', width / Math.max(width, height));
        marker.style.setProperty('--height-ratio', height / Math.max(width, height));
        const symbol = document.createElement('span');
        symbol.className = 'symbol';
        const svg = artwork(icon);
        if (icon.source === 'Tabler') svg.setAttribute('stroke', 'var(--aircraft, #66bb6a)');
        symbol.append(svg);
        const shadow = document.createElement('span');
        shadow.className = 'shadow';
        // Clone the finished artwork so heading, silhouette and detail match exactly.
        shadow.append(svg.cloneNode(true));
        marker.append(shadow, symbol);
        return marker;
    }

    function preview(icon, className) {
        const element = document.createElement('span');
        element.className = `terrain ${className}`;
        element.style.display = 'block';
        const north = document.createElement('span');
        north.className = 'north';
        north.textContent = '↑ N';
        element.append(north, marker(icon));
        return element;
    }

    function originalUrl(icon) {
        return icon.source === 'Tabler'
            ? `https://github.com/tabler/tabler-icons/blob/ed177a085b652fe04ec4f37ced867c94621e7840/icons/outline/${icon.key.slice(7)}.svg`
            : 'https://github.com/wiedehopf/tar1090/blob/5d59b1ba2c5e30eb23f1161940367b7767f10ad5/html/markers.js';
    }

    function openDetail(icon) {
        document.getElementById('detail-title').textContent = icon.name;
        document.getElementById('detail-group').textContent = icon.group;
        document.getElementById('detail-key').textContent = icon.key;
        document.getElementById('detail-source').textContent = icon.source;
        document.getElementById('detail-license').textContent = icon.license;
        document.getElementById('detail-rotation').textContent = icon.noRotate ? 'Fixed orientation in the source' : 'Follows heading';
        document.getElementById('detail-note').textContent = icon.source === 'Tabler'
            ? 'Supplementary UI artwork. Its original side or angled view is preserved here.'
            : 'Enlarged for inspection. The gallery shows the size selected in the controls.';
        const display = document.getElementById('detail-preview');
        display.replaceChildren(marker(icon));
        document.getElementById('original').href = originalUrl(icon);
        if (downloadUrl) URL.revokeObjectURL(downloadUrl);
        const svg = artwork(icon);
        if (icon.source === 'Tabler') svg.setAttribute('stroke', '#66bb6a');
        const description = svgElement('desc', {});
        description.textContent = `${icon.name}. Source: ${originalUrl(icon)}. License: ${icon.license}. See the Ground Station aircraft-icon-preview/NOTICE.md for credits and adaptation notes.`;
        svg.prepend(description);
        // Export self-contained colors and the source proportions, independent of page CSS.
        for (const element of [svg, ...svg.querySelectorAll('*')]) {
            for (const name of ['fill', 'stroke']) {
                const value = element.getAttribute(name);
                if (value?.startsWith('var(')) element.setAttribute(name, name === 'fill' ? '#66bb6a' : '#17211a');
            }
        }
        downloadUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], {type: 'image/svg+xml'}));
        const download = document.getElementById('download');
        download.href = downloadUrl;
        download.download = `${icon.key}.svg`;
        if (!detail.open) detail.showModal();
    }

    function render() {
        const query = document.getElementById('search').value.trim().toLowerCase();
        const collection = document.getElementById('collection').value;
        let count = 0;
        for (const icon of icons) {
            const inCollection = collection === 'all' || collection === 'aviation' && icon.aviation
                || collection === 'other' && icon.source === 'tar1090' && !icon.aviation
                || collection === 'supplementary' && icon.source === 'Tabler' || collection === `group:${icon.group}`;
            const matches = inCollection && `${icon.name} ${icon.key} ${icon.group}`.toLowerCase().includes(query);
            icon.card.hidden = !matches;
            if (matches) count += 1;
        }
        document.getElementById('results').textContent = `${count} of ${icons.length} icons`;
        document.getElementById('empty').hidden = count !== 0;
    }

    for (const group of Object.keys(groups)) {
        const option = document.createElement('option');
        option.value = `group:${group}`;
        option.textContent = group;
        document.getElementById('categories').append(option);
    }
    for (const icon of icons) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'card';
        card.dataset.key = icon.key;
        const copy = document.createElement('span');
        copy.className = 'card-copy';
        const name = document.createElement('span');
        name.className = 'card-name';
        name.textContent = icon.name;
        const meta = document.createElement('span');
        meta.className = 'card-meta';
        const key = document.createElement('span');
        key.className = 'card-key';
        key.textContent = icon.key;
        const source = document.createElement('span');
        source.textContent = icon.source;
        meta.append(key, source);
        copy.append(name, meta);
        card.append(preview(icon, 'card-preview'), copy);
        card.addEventListener('click', () => openDetail(icon));
        gallery.append(card);
        icon.card = card;
    }

    const root = document.documentElement;
    const applyControls = () => {
        const heading = document.getElementById('heading').value;
        const size = document.getElementById('size').value;
        root.style.setProperty('--heading', `${heading}deg`);
        root.style.setProperty('--size', `${size}px`);
        root.classList.toggle('shadows-off', !document.getElementById('shadows').checked);
        root.classList.toggle('dark-terrain', document.getElementById('terrain').value === 'dark');
        document.getElementById('heading-value').value = `${heading}°`;
        document.getElementById('size-value').value = `${size} px`;
    };
    ['heading', 'size', 'shadows', 'terrain'].forEach(id => document.getElementById(id).addEventListener('input', applyControls));
    ['search', 'collection'].forEach(id => document.getElementById(id).addEventListener('input', render));
    document.getElementById('reset').addEventListener('click', () => {
        document.getElementById('search').value = '';
        document.getElementById('collection').value = 'all';
        document.getElementById('terrain').value = 'light';
        document.getElementById('heading').value = '0';
        document.getElementById('size').value = '32';
        document.getElementById('shadows').checked = true;
        applyControls();
        render();
    });
    document.getElementById('close-detail').addEventListener('click', () => detail.close());
    detail.addEventListener('click', event => {
        // Clicking the native backdrop closes the preview; clicks inside keep it open.
        if (event.target === detail) {
            const bounds = detail.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) detail.close();
        }
    });
    detail.addEventListener('close', () => {
        if (downloadUrl) URL.revokeObjectURL(downloadUrl);
        downloadUrl = null;
    });
    applyControls();
    render();
})();
