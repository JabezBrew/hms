import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getApiBasePathname,
  getApiBaseUrl,
  getDefaultFacilityCode,
  getRuntimeConfig,
  getWebSocketBaseUrl,
  isMultiFacilityModeEnabled,
} from '../runtime-config';

describe('runtime-config', () => {
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;
  const originalLocation = globalThis.window.location;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = undefined;
    Object.defineProperty(globalThis.window, 'location', {
      value: {
        protocol: 'https:',
        host: 'frontend.example.com',
      },
      configurable: true,
    });
  });

  afterEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    Object.defineProperty(globalThis.window, 'location', {
      value: originalLocation,
      configurable: true,
    });
  });

  it('ignores unsubstituted placeholder values and falls back safely', () => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiBaseUrl: '$API_BASE_URL',
      wsUrl: '$WS_URL',
      defaultFacilityCode: '$DEFAULT_FACILITY_CODE',
      multiFacilityMode: '$MULTI_FACILITY_MODE',
    };

    expect(getApiBaseUrl()).toBe('/api');
    expect(getApiBasePathname()).toBe('/api');
    expect(getDefaultFacilityCode()).toBeNull();
    expect(isMultiFacilityModeEnabled()).toBe(false);
  });

  it('prefers runtime-config values over build-time defaults', () => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiBaseUrl: 'https://api.example.com/api/',
      wsUrl: 'wss://realtime.example.com/',
      defaultFacilityCode: 'main',
      multiFacilityMode: 'true',
    };

    expect(getApiBaseUrl()).toBe('https://api.example.com/api');
    expect(getApiBasePathname()).toBe('/api');
    expect(getWebSocketBaseUrl()).toBe('wss://realtime.example.com');
    expect(getDefaultFacilityCode()).toBe('MAIN');
    expect(isMultiFacilityModeEnabled()).toBe(true);
  });

  it('derives websocket URL from absolute API base when no explicit ws URL is configured', () => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiBaseUrl: 'https://api.example.com/api',
    };

    expect(getWebSocketBaseUrl()).toBe('wss://api.example.com');
  });

  it('returns a normalized runtime config snapshot', () => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiBaseUrl: 'https://api.example.com/api/',
      defaultFacilityCode: 'satellite',
      multiFacilityMode: 'yes',
    };

    expect(getRuntimeConfig()).toEqual({
      apiBaseUrl: 'https://api.example.com/api',
      apiBasePathname: '/api',
      wsUrl: 'wss://api.example.com',
      defaultFacilityCode: 'SATELLITE',
      multiFacilityMode: true,
    });
  });
});
