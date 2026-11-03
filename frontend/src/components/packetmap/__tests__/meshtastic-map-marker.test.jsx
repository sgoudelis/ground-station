import React from 'react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {fireEvent, render, waitFor} from '@testing-library/react';
import {Map as LeafletMap} from 'leaflet';
import {useMap} from 'react-leaflet';
import MeshtasticMapMarker from '../meshtastic-map-marker.jsx';
import {createMeshtasticRenderer, MeshtasticMarker} from '../meshtastic-marker.js';

vi.mock('react-leaflet', () => ({useMap: vi.fn()}));

let map;
let container;
let image;
beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperties(container, {
        clientWidth: {value: 600}, clientHeight: {value: 400},
        offsetWidth: {value: 600}, offsetHeight: {value: 400},
    });
    container.getBoundingClientRect = () => ({x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400});
    document.body.appendChild(container);
    map = new LeafletMap(container, {zoomControl: false, attributionControl: false, zoomAnimation: false}).setView([40, 23], 12);
    useMap.mockReturnValue(map);
    vi.spyOn(window, 'Image').mockImplementation(function () {
        image = document.createElement('img');
        return image;
    });
});
afterEach(() => {
    map.remove();
    container.remove();
    vi.restoreAllMocks();
});

it('shares a canvas and image, selects the pin body, moves existing layers and cleans up on unmount', () => {
    const renderer = createMeshtasticRenderer();
    const onSelect = vi.fn();
    const element = (latitude = 40, onSelectTransmitter = onSelect, name = 'FIRST', selected = false) => <>
        <MeshtasticMapMarker id="first" latitude={latitude} longitude={23} name={name} selected={selected}
            renderer={renderer} onSelectTransmitter={onSelectTransmitter} />
        <MeshtasticMapMarker id="second" latitude={40} longitude={23.02} renderer={renderer} onSelectTransmitter={onSelectTransmitter} />
    </>;
    const view = render(element());
    const nodes = () => Object.values(map._layers).filter((layer) => layer instanceof MeshtasticMarker);
    const layers = nodes();
    expect(layers).toHaveLength(2);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(container.querySelectorAll('.leaflet-marker-icon, .leaflet-tooltip')).toHaveLength(0);
    expect(window.Image).toHaveBeenCalledTimes(1);
    const context = renderer._ctx;
    expect(context.measureText).toHaveBeenCalledWith('FIRST');
    context.measureText.mockClear();

    const clickBody = (latitude) => {
        const point = map.latLngToContainerPoint([latitude, 23]);
        // The middle of the pin is well outside the old circle at its tip.
        fireEvent.click(container.querySelector('canvas'), {clientX: point.x, clientY: point.y - 18});
    };
    clickBody(40);
    expect(onSelect).toHaveBeenCalledWith('first');
    const latestSelect = vi.fn();
    view.rerender(element(40.001, latestSelect));
    expect(nodes()).toEqual(layers);
    expect(window.Image).toHaveBeenCalledTimes(1);
    expect(layers[0].getLatLng().lat).toBe(40.001);
    expect(context.measureText).not.toHaveBeenCalled();
    clickBody(40.001);
    expect(latestSelect).toHaveBeenCalledWith('first');
    view.rerender(element(40.001, latestSelect, 'RENAMED', true));
    expect(nodes()).toEqual(layers);
    expect(layers[0].options.label).toBe('RENAMED');
    expect(context.measureText).toHaveBeenCalledOnce();
    const tip = map.latLngToContainerPoint([40.001, 23]);
    // Neither the permanent label nor the baked shadow steals map clicks.
    const clicks = latestSelect.mock.calls.length;
    fireEvent.click(container.querySelector('canvas'), {clientX: tip.x, clientY: tip.y - 60});
    fireEvent.click(container.querySelector('canvas'), {clientX: tip.x + 25, clientY: tip.y - 18});
    expect(latestSelect).toHaveBeenCalledTimes(clicks);
    view.unmount();
    expect(nodes()).toHaveLength(0);
});

it('draws pins after a delayed image load and safely handles image completion after map removal', async () => {
    const renderer = createMeshtasticRenderer();
    const name = '<img src=x onerror="alert(1)">';
    const view = render(<MeshtasticMapMarker id="node" name={name} latitude={40} longitude={23} renderer={renderer} />);
    const context = renderer._ctx;
    expect(image.src).toContain('meshtastic-shadow.png');
    Object.defineProperties(image, {complete: {value: true}, naturalWidth: {value: 96}});
    image.onload();
    await waitFor(() => expect(context.drawImage).toHaveBeenCalledWith(image, expect.any(Number), expect.any(Number), 68, 76.5));
    expect(context.fillText).toHaveBeenCalledWith(name, expect.any(Number), expect.any(Number));
    expect(container.querySelectorAll('img')).toHaveLength(0);
    view.unmount();
    map.removeLayer(renderer);
    expect(() => image.onload()).not.toThrow();
});
