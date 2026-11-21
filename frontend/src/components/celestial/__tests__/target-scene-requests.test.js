import { configureStore } from '@reduxjs/toolkit';
import { Manager } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import celestialReducer, { fetchTargetCelestialScene } from '../celestial-slice.jsx';

const REQUEST_TIMEOUT_MS = 60_000;
const requestKey = 'body:moon:0:24:60';
const payload = {
  celestial: [{ target_type: 'body', target_key: 'body:moon', body_id: 'moon', name: 'Moon' }],
  allow_network_fetch: true,
};
const solarScene = { planets: [{ target_key: 'body:earth' }] };
const celestialTracks = {
  celestial: [{ target_key: 'body:moon', name: 'Moon' }],
  celestial_passes: [{ target_key: 'body:moon', id: 'moon-pass' }],
};

const createHarness = () => {
  // Keep Socket.IO's real ACK, timeout and disconnect behavior. Only replace
  // transport writes so these tests need neither a server nor an open socket.
  const manager = new Manager('http://localhost', { autoConnect: false });
  const packets = [];
  manager._packet = (packet) => packets.push(packet);
  const socket = manager.socket('/');
  socket.onconnect('initial-session');
  const store = configureStore({ reducer: { celestial: celestialReducer } });
  const request = () => store.dispatch(fetchTargetCelestialScene({ socket, payload, requestKey }));
  const entry = () => store.getState().celestial.targetScenesByKey[requestKey];
  const reply = (packet, data, success = true) => socket.onpacket({
    type: 3,
    nsp: '/',
    id: packet.id,
    data: [success ? { success, data } : { success, error: data }],
  });
  return { socket, packets, request, entry, reply };
};

describe('shared target scene requests', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('shares an in-flight Moon request across islands and waits for both replies', async () => {
    const { request, packets, entry, reply } = createHarness();
    const first = request();
    const duplicate = await request();
    expect(duplicate.meta.condition).toBe(true);
    expect(packets).toHaveLength(2);

    reply(packets[1], celestialTracks);
    await vi.advanceTimersByTimeAsync(0);
    expect(entry().loading).toBe(true);
    reply(packets[0], solarScene);

    expect(fetchTargetCelestialScene.fulfilled.match(await first)).toBe(true);
    expect(entry()).toMatchObject({ loading: false, error: null, solarScene, celestialTracks });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries a lost reply once without repeating the successful scene read', async () => {
    const { request, packets, entry, reply } = createHarness();
    const pending = request();
    reply(packets[0], solarScene);

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(packets).toHaveLength(3);
    expect(packets[2].data).toEqual(['api.call', { cmd: 'get-celestial-tracks', data: payload }]);
    expect(entry().loading).toBe(true);
    reply(packets[2], celestialTracks);

    expect(fetchTargetCelestialScene.fulfilled.match(await pending)).toBe(true);
    expect(entry()).toMatchObject({ loading: false, error: null, solarScene, celestialTracks });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers after Socket.IO discards the original ACKs on disconnect', async () => {
    const { socket, request, packets, entry, reply } = createHarness();
    const pending = request();
    socket.onclose('transport close');
    await vi.advanceTimersByTimeAsync(0);
    socket.onconnect('reconnected-session');

    expect(packets).toHaveLength(4);
    reply(packets[2], solarScene);
    reply(packets[3], celestialTracks);
    expect(fetchTargetCelestialScene.fulfilled.match(await pending)).toBe(true);
    expect(entry()).toMatchObject({ loading: false, error: null, solarScene, celestialTracks });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the loading guard after repeated missing replies so Refresh can retry', async () => {
    const { request, packets, entry, reply } = createHarness();
    const pending = request();
    reply(packets[0], solarScene);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 2);

    expect(fetchTargetCelestialScene.rejected.match(await pending)).toBe(true);
    expect(entry().loading).toBe(false);
    expect(entry().error).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);

    const retry = request();
    // A delayed ACK from the expired attempt must not complete the new scene.
    reply(packets[1], { celestial: [{ name: 'Expired response' }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(entry().loading).toBe(true);
    reply(packets[3], solarScene);
    reply(packets[4], celestialTracks);
    expect(fetchTargetCelestialScene.fulfilled.match(await retry)).toBe(true);
    expect(entry()).toMatchObject({ loading: false, error: null, celestialTracks });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears loading when the connection never returns and removes buffered retries', async () => {
    const { socket, request, entry } = createHarness();
    const pending = request();
    socket.onclose('transport close');
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    expect(fetchTargetCelestialScene.rejected.match(await pending)).toBe(true);
    expect(entry().loading).toBe(false);
    expect(socket.sendBuffer).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports server errors without retrying a completed backend request', async () => {
    const { request, packets, entry, reply } = createHarness();
    const pending = request();
    reply(packets[0], solarScene);
    reply(packets[1], 'Ephemeris unavailable', false);

    expect(fetchTargetCelestialScene.rejected.match(await pending)).toBe(true);
    expect(entry()).toMatchObject({ loading: false, error: 'Ephemeris unavailable' });
    expect(packets).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
