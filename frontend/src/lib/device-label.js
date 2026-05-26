const BROWSER_BRAND_PATTERNS = [
  [/edge/, 'Edge'],
  [/chrome/, 'Chrome'],
  [/firefox/, 'Firefox'],
  [/opera/, 'Opera'],
  [/safari/, 'Safari'],
  [/chromium/, 'Chrome'],
];

function browserFromBrands(brands = []) {
  for (const brandItem of brands) {
    const brand = String(brandItem?.brand || '').toLowerCase();
    if (!brand || brand === 'not a brand' || brand === 'not_a_brand') {
      continue;
    }
    for (const [pattern, browser] of BROWSER_BRAND_PATTERNS) {
      if (pattern.test(brand)) return browser;
    }
  }
  return '';
}

function browserFromUserAgent(ua) {
  if (!ua) return '';
  if (ua.includes('edgios') || ua.includes('edga/') || ua.includes('edg/') || ua.includes('edge/')) return 'Edge';
  if (ua.includes('crios') || (ua.includes('chrome') && !ua.includes('edg') && !ua.includes('opr/'))) return 'Chrome';
  if (ua.includes('fxios') || ua.includes('firefox')) return 'Firefox';
  if (ua.includes('opios') || ua.includes('opera') || ua.includes('opr/')) return 'Opera';
  if (ua.includes('safari') && !ua.includes('chrome') && !ua.includes('crios')) return 'Safari';
  return '';
}

function osFromHintsOrUserAgent(platform, ua, maxTouchPoints = 0) {
  const platformLower = String(platform || '').toLowerCase();
  const looksLikeIos = ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod');
  const iosDesktopMode = ua.includes('macintosh') && ua.includes('mobile/') && maxTouchPoints > 1;

  if (
    platformLower.includes('ios') ||
    looksLikeIos ||
    iosDesktopMode
  ) {
    return 'iOS';
  }
  if (platformLower.includes('android') || ua.includes('android')) {
    return 'Android';
  }
  if (platformLower.includes('windows') || ua.includes('windows')) {
    return 'Windows';
  }
  if (
    platformLower.includes('mac') ||
    ((ua.includes('macintosh') || ua.includes('mac os x')) && !ua.includes('like mac os x'))
  ) {
    return 'macOS';
  }
  if (platformLower.includes('linux') || ua.includes('linux')) {
    return 'Linux';
  }
  return '';
}

export function getClientDeviceLabel() {
  const nav = globalThis?.navigator;
  if (!nav) {
    return '';
  }

  const ua = String(nav.userAgent || '').toLowerCase();
  const uaData = nav.userAgentData;
  const browser = browserFromBrands(uaData?.brands) || browserFromUserAgent(ua) || 'Browser';
  const osName = osFromHintsOrUserAgent(
    uaData?.platform || nav.platform || '',
    ua,
    Number(nav.maxTouchPoints || 0),
  );
  return osName ? `${browser} on ${osName}` : browser;
}
