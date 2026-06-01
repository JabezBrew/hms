import { safeStorage, rawStorage } from "@/lib/safe-storage";

export const AUTH_STORAGE_KEYS = {
  user: { current: "auth_user", legacy: "user" },
  sessionStartTime: { current: "auth_session_start_time", legacy: "sessionStartTime" },
  lastActivityAt: { current: "auth_last_activity_at", legacy: "lastActivityAt" },
  refreshTokenIssuedAt: { current: "auth_refresh_token_issued_at", legacy: "refreshTokenIssuedAt" },
  sessionIdleExpiresAt: { current: "auth_session_idle_expires_at", legacy: "sessionIdleExpiresAt" },
  sessionAbsoluteExpiresAt: { current: "auth_session_absolute_expires_at", legacy: "sessionAbsoluteExpiresAt" },
};

const getKeyPair = (key) => {
  const pair = AUTH_STORAGE_KEYS[key];
  if (!pair) {
    throw new Error(`Unknown auth storage key: ${key}`);
  }
  return pair;
};

const setCurrentValue = (pair, value, asJson) => {
  return asJson ? safeStorage.setJSON(pair.current, value) : safeStorage.set(pair.current, value);
};

const migrateLegacyValue = (key, legacyValue, asJson) => {
  if (legacyValue === null || legacyValue === undefined) {
    return false;
  }

  const pair = getKeyPair(key);
  const stored = setCurrentValue(pair, legacyValue, asJson);
  if (stored) {
    rawStorage.remove(pair.legacy);
  }
  return stored;
};

export const getAuthValue = (key, fallback = null) => {
  const pair = getKeyPair(key);
  const currentValue = safeStorage.get(pair.current, null);
  if (currentValue !== null) {
    return currentValue;
  }

  const legacyValue = rawStorage.get(pair.legacy, null);
  if (legacyValue !== null) {
    migrateLegacyValue(key, legacyValue, false);
    return legacyValue;
  }

  return fallback;
};

export const getAuthJSON = (key, fallback = null) => {
  const pair = getKeyPair(key);
  const currentRaw = safeStorage.get(pair.current, null);
  if (currentRaw !== null) {
    try {
      return JSON.parse(currentRaw);
    } catch {
      safeStorage.remove(pair.current);
      return fallback;
    }
  }

  const legacyRaw = rawStorage.get(pair.legacy, null);
  if (legacyRaw !== null) {
    try {
      const parsed = JSON.parse(legacyRaw);
      migrateLegacyValue(key, parsed, true);
      return parsed;
    } catch {
      rawStorage.remove(pair.legacy);
      return fallback;
    }
  }

  return fallback;
};

export const setAuthValue = (key, value) => {
  const pair = getKeyPair(key);
  const stored = safeStorage.set(pair.current, value);
  if (stored) {
    rawStorage.remove(pair.legacy);
  }
  return stored;
};

export const setAuthJSON = (key, value) => {
  const pair = getKeyPair(key);
  const stored = safeStorage.setJSON(pair.current, value);
  if (stored) {
    rawStorage.remove(pair.legacy);
  }
  return stored;
};

export const removeAuthValue = (key) => {
  const pair = getKeyPair(key);
  safeStorage.remove(pair.current);
  rawStorage.remove(pair.legacy);
};
