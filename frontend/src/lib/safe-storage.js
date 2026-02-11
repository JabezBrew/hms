/**
 * Safe localStorage wrapper with error handling and versioning.
 *
 * Handles cases where localStorage is unavailable (private browsing,
 * storage quota exceeded, etc.) without throwing errors.
 *
 * @example
 * import { safeStorage } from '@/lib/safe-storage';
 *
 * // Get a value with fallback
 * const theme = safeStorage.get('theme', 'light');
 *
 * // Set a value
 * safeStorage.set('theme', 'dark');
 *
 * // Remove a value
 * safeStorage.remove('theme');
 */

const STORAGE_VERSION = 'v1';
const STORAGE_PREFIX = 'hms';

/**
 * Generates a prefixed storage key for consistency and versioning.
 * @param {string} key - The key name
 * @returns {string} - Prefixed key
 */
export function getStorageKey(key) {
  return `${STORAGE_PREFIX}_${STORAGE_VERSION}_${key}`;
}

/**
 * Checks if localStorage is available.
 * @returns {boolean}
 */
function isStorageAvailable() {
  try {
    const test = '__storage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

// Cache the availability check
const storageAvailable = isStorageAvailable();

export const safeStorage = {
  /**
   * Gets a value from localStorage.
   * @param {string} key - The key to retrieve
   * @param {*} fallback - Default value if key doesn't exist or storage unavailable
   * @returns {*} - The stored value or fallback
   */
  get(key, fallback = null) {
    if (!storageAvailable) {
      return fallback;
    }

    try {
      const value = localStorage.getItem(getStorageKey(key));
      return value !== null ? value : fallback;
    } catch {
      return fallback;
    }
  },

  /**
   * Gets and parses a JSON value from localStorage.
   * @param {string} key - The key to retrieve
   * @param {*} fallback - Default value if key doesn't exist or parse fails
   * @returns {*} - The parsed value or fallback
   */
  getJSON(key, fallback = null) {
    if (!storageAvailable) {
      return fallback;
    }

    try {
      const value = localStorage.getItem(getStorageKey(key));
      if (value === null) {
        return fallback;
      }
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  },

  /**
   * Sets a value in localStorage.
   * @param {string} key - The key to set
   * @param {string} value - The value to store
   * @returns {boolean} - Whether the operation succeeded
   */
  set(key, value) {
    if (!storageAvailable) {
      return false;
    }

    try {
      localStorage.setItem(getStorageKey(key), value);
      return true;
    } catch (error) {
      // Could be QuotaExceededError
      console.warn('localStorage unavailable:', error?.message);
      return false;
    }
  },

  /**
   * Sets a JSON value in localStorage.
   * @param {string} key - The key to set
   * @param {*} value - The value to store (will be JSON stringified)
   * @returns {boolean} - Whether the operation succeeded
   */
  setJSON(key, value) {
    if (!storageAvailable) {
      return false;
    }

    try {
      localStorage.setItem(getStorageKey(key), JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn('localStorage unavailable:', error?.message);
      return false;
    }
  },

  /**
   * Removes a value from localStorage.
   * @param {string} key - The key to remove
   */
  remove(key) {
    if (!storageAvailable) {
      return;
    }

    try {
      localStorage.removeItem(getStorageKey(key));
    } catch {
      // Silently fail
    }
  },

  /**
   * Checks if localStorage is available.
   * @returns {boolean}
   */
  isAvailable() {
    return storageAvailable;
  },
};

/**
 * Raw localStorage access without prefixing (for backwards compatibility).
 * Use this for existing keys that don't use the prefix, or for auth-related
 * storage that needs to work with existing data.
 */
export const rawStorage = {
  get(key, fallback = null) {
    if (!storageAvailable) {
      return fallback;
    }

    try {
      const value = localStorage.getItem(key);
      return value !== null ? value : fallback;
    } catch {
      return fallback;
    }
  },

  getJSON(key, fallback = null) {
    if (!storageAvailable) {
      return fallback;
    }

    try {
      const value = localStorage.getItem(key);
      if (value === null) {
        return fallback;
      }
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  },

  set(key, value) {
    if (!storageAvailable) {
      return false;
    }

    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.warn('localStorage unavailable:', error?.message);
      return false;
    }
  },

  setJSON(key, value) {
    if (!storageAvailable) {
      return false;
    }

    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn('localStorage unavailable:', error?.message);
      return false;
    }
  },

  remove(key) {
    if (!storageAvailable) {
      return;
    }

    try {
      localStorage.removeItem(key);
    } catch {
      // Silently fail
    }
  },

  isAvailable() {
    return storageAvailable;
  },
};

export default safeStorage;
