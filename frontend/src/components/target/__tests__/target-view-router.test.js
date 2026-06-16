import { describe, expect, it } from 'vitest';
import { resolveEffectiveMapEngine } from '../target-view-router.jsx';

describe('resolveEffectiveMapEngine', () => {
  it('returns current map engine when auto-switch is disabled', () => {
    const result = resolveEffectiveMapEngine({
      mapEngine: 'maplibre',
      autoSwitchPlanetariumByVisibility: false,
      targetType: 'satellite',
      targetElevation: 42,
    });

    expect(result).toBe('maplibre');
  });

  it('returns current map engine for non-satellite targets', () => {
    const result = resolveEffectiveMapEngine({
      mapEngine: 'planetarium',
      autoSwitchPlanetariumByVisibility: true,
      targetType: 'mission',
      targetElevation: -5,
    });

    expect(result).toBe('planetarium');
  });

  it('switches to planetarium when satellite elevation is above horizon', () => {
    const result = resolveEffectiveMapEngine({
      mapEngine: 'maplibre',
      autoSwitchPlanetariumByVisibility: true,
      targetType: 'satellite',
      targetElevation: 0.2,
    });

    expect(result).toBe('planetarium');
  });

  it('switches to globe when satellite elevation is at or below horizon', () => {
    const below = resolveEffectiveMapEngine({
      mapEngine: 'maplibre',
      autoSwitchPlanetariumByVisibility: true,
      targetType: 'satellite',
      targetElevation: -0.1,
    });
    const atHorizon = resolveEffectiveMapEngine({
      mapEngine: 'maplibre',
      autoSwitchPlanetariumByVisibility: true,
      targetType: 'satellite',
      targetElevation: 0,
    });

    expect(below).toBe('maplibre-globe');
    expect(atHorizon).toBe('maplibre-globe');
  });

  it('keeps current map engine when elevation is unavailable', () => {
    const result = resolveEffectiveMapEngine({
      mapEngine: 'leaflet',
      autoSwitchPlanetariumByVisibility: true,
      targetType: 'satellite',
      targetElevation: null,
    });

    expect(result).toBe('leaflet');
  });
});
