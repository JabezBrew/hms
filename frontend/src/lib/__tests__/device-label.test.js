import { afterEach, describe, expect, it } from 'vitest';

import { getClientDeviceLabel } from '../device-label';

const originalNavigatorValues = {
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints,
  userAgentData: navigator.userAgentData,
};

function setNavigatorValue(key, value) {
  Object.defineProperty(navigator, key, {
    configurable: true,
    value,
  });
}

describe('getClientDeviceLabel', () => {
  afterEach(() => {
    setNavigatorValue('userAgent', originalNavigatorValues.userAgent);
    setNavigatorValue('platform', originalNavigatorValues.platform);
    setNavigatorValue('maxTouchPoints', originalNavigatorValues.maxTouchPoints);
    setNavigatorValue('userAgentData', originalNavigatorValues.userAgentData);
  });

  it('detects iPhone Safari as iOS', () => {
    setNavigatorValue(
      'userAgent',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) '
      + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 '
      + 'Mobile/15E148 Safari/604.1',
    );
    setNavigatorValue('platform', 'iPhone');
    setNavigatorValue('maxTouchPoints', 5);
    setNavigatorValue('userAgentData', undefined);

    expect(getClientDeviceLabel()).toBe('Safari on iOS');
  });

  it('detects iPad desktop-mode Safari as iOS', () => {
    setNavigatorValue(
      'userAgent',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
      + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 '
      + 'Mobile/15E148 Safari/604.1',
    );
    setNavigatorValue('platform', 'MacIntel');
    setNavigatorValue('maxTouchPoints', 5);
    setNavigatorValue('userAgentData', undefined);

    expect(getClientDeviceLabel()).toBe('Safari on iOS');
  });

  it('uses userAgentData brands when available', () => {
    setNavigatorValue('userAgent', 'Mozilla/5.0');
    setNavigatorValue('platform', 'Windows');
    setNavigatorValue('maxTouchPoints', 0);
    setNavigatorValue('userAgentData', {
      platform: 'Windows',
      brands: [
        { brand: 'Chromium', version: '121' },
        { brand: 'Google Chrome', version: '121' },
      ],
    });

    expect(getClientDeviceLabel()).toBe('Chrome on Windows');
  });
});
