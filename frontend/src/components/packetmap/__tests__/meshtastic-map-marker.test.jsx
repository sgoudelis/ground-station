import React from 'react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {act, render} from '@testing-library/react';
import {useMap} from 'react-map-gl/maplibre';
import MeshtasticMapMarker from '../meshtastic-map-marker.jsx';
import {createMeshtasticRenderer} from '../meshtastic-marker.js';

vi.mock('react-map-gl/maplibre', () => ({useMap: vi.fn()}));

let map;
let container;
let image;
let listeners;
beforeEach(() => {
    container = document.createElement('div');
    container.getBoundingClientRect = () => ({width: 600, height: 400});
    document.body.appendChild(container);
    listeners = new Map();
    map = {
        getContainer: () => container,
        project: ([longitude, latitude]) => ({x: 300 + (longitude - 23) * 1000, y: 200 - (latitude - 40) * 1000}),
        on: vi.fn((event, callback) => listeners.set(event, callback)),
        off: vi.fn((event) => listeners.delete(event)),
        triggerRepaint: vi.fn(),
    };
    useMap.mockReturnValue({current: {getMap: () => map}});
    vi.spyOn(window, 'Image').mockImplementation(function () {
        image = document.createElement('img');
        return image;
    });
});
afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
});

it('shares a canvas and image, selects the pin body, moves existing registrations and cleans up on unmount', () => {
    const renderer = createMeshtasticRenderer();
    const onSelect = vi.fn();
    const element = (latitude = 40, onSelectTransmitter = onSelect, name = 'FIRST', selected = false) => <>
        <MeshtasticMapMarker id="first" latitude={latitude} longitude={23} name={name} selected={selected}
            renderer={renderer} onSelectTransmitter={onSelectTransmitter} />
        <MeshtasticMapMarker id="second" latitude={40} longitude={23.06} renderer={renderer} onSelectTransmitter={onSelectTransmitter} />
    </>;
    const view = render(element());
    const registrations = [...renderer.markers];
    act(() => listeners.get('render')());
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(container.querySelectorAll('.maplibregl-marker')).toHaveLength(0);
    expect(window.Image).toHaveBeenCalledTimes(1);
    const context = renderer.context;
    expect(context.measureText).toHaveBeenCalledWith('FIRST');
    context.measureText.mockClear();
    const clickBody = (latitude) => {
        const point = map.project([23, latitude]);
        listeners.get('click')({point: {x: point.x, y: point.y - 18}});
    };
    clickBody(40);
    expect(onSelect).toHaveBeenCalledWith('first');
    const latestSelect = vi.fn();
    view.rerender(element(40.001, latestSelect));
    act(() => listeners.get('render')());
    expect([...renderer.markers]).toEqual(registrations);
    expect(window.Image).toHaveBeenCalledTimes(1);
    expect(registrations[0].latitude).toBe(40.001);
    expect(context.measureText).not.toHaveBeenCalled();
    clickBody(40.001);
    expect(latestSelect).toHaveBeenCalledWith('first');
    view.rerender(element(40.001, latestSelect, 'RENAMED', true));
    act(() => listeners.get('render')());
    expect([...renderer.markers]).toEqual(registrations);
    expect(context.measureText).toHaveBeenCalledExactlyOnceWith('RENAMED');
    const tip = map.project([23, 40.001]);
    const clicks = latestSelect.mock.calls.length;
    // Neither the permanent label nor the baked shadow steals map clicks.
    listeners.get('click')({point: {x: tip.x, y: tip.y - 60}});
    listeners.get('click')({point: {x: tip.x + 25, y: tip.y - 18}});
    expect(latestSelect).toHaveBeenCalledTimes(clicks);
    view.unmount();
    expect(renderer.markers.size).toBe(0);
    expect(listeners.size).toBe(0);
    expect(container.querySelector('canvas')).toBeNull();
});

it('repaints after delayed image loading and ignores image completion after map removal', () => {
    const renderer = createMeshtasticRenderer();
    const name = '<img src=x onerror="alert(1)">';
    const view = render(<MeshtasticMapMarker id="node" name={name} latitude={40} longitude={23} renderer={renderer} />);
    const context = renderer.context;
    expect(image.src).toContain('meshtastic-shadow.png');
    Object.defineProperties(image, {complete: {value: true}, naturalWidth: {value: 96}});
    image.onload();
    act(() => listeners.get('render')());
    expect(context.drawImage).toHaveBeenCalledWith(image, expect.any(Number), expect.any(Number), 68, 76.5);
    expect(context.fillText).toHaveBeenCalledWith(name, expect.any(Number), expect.any(Number));
    expect(container.querySelectorAll('img')).toHaveLength(0);
    view.unmount();
    map.triggerRepaint.mockClear();
    expect(() => image.onload()).not.toThrow();
    expect(map.triggerRepaint).not.toHaveBeenCalled();
});
