import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Normalizes API response data to always return an array.
 *
 * The apiClient.handlePaginatedResponse unwraps paginated responses like
 * {results: [...]} to just [...], but some code expects the full object.
 * This utility handles both cases consistently.
 *
 * @param {Array|Object|null|undefined} data - API response data
 * @param {string} arrayKey - Key to look for if data is an object (default: 'results')
 * @returns {Array} - Always returns an array
 *
 * @example
 * // All these return the same array:
 * normalizeApiResults([{id: 1}])                    // Already an array
 * normalizeApiResults({results: [{id: 1}]})         // Paginated response
 * normalizeApiResults({items: [{id: 1}]}, 'items') // Custom key
 */
export function normalizeApiResults(data, arrayKey = 'results') {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data[arrayKey] && Array.isArray(data[arrayKey])) return data[arrayKey];
  return [];
}

/**
 * Badge color palettes for hash-based coloring.
 * Each palette has light bg, dark bg, light text, dark text.
 */
const BADGE_COLORS = [
  { bg: 'bg-sky-100', darkBg: 'dark:bg-sky-900/30', text: 'text-sky-700', darkText: 'dark:text-sky-400' },
  { bg: 'bg-amber-100', darkBg: 'dark:bg-amber-900/30', text: 'text-amber-700', darkText: 'dark:text-amber-400' },
  { bg: 'bg-emerald-100', darkBg: 'dark:bg-emerald-900/30', text: 'text-emerald-700', darkText: 'dark:text-emerald-400' },
  { bg: 'bg-violet-100', darkBg: 'dark:bg-violet-900/30', text: 'text-violet-700', darkText: 'dark:text-violet-400' },
  { bg: 'bg-rose-100', darkBg: 'dark:bg-rose-900/30', text: 'text-rose-700', darkText: 'dark:text-rose-400' },
  { bg: 'bg-cyan-100', darkBg: 'dark:bg-cyan-900/30', text: 'text-cyan-700', darkText: 'dark:text-cyan-400' },
  { bg: 'bg-orange-100', darkBg: 'dark:bg-orange-900/30', text: 'text-orange-700', darkText: 'dark:text-orange-400' },
  { bg: 'bg-indigo-100', darkBg: 'dark:bg-indigo-900/30', text: 'text-indigo-700', darkText: 'dark:text-indigo-400' },
];

/**
 * Generate a simple hash from a string.
 * @param {string} str - Input string
 * @returns {number} - Hash value
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Get a deterministic color class string based on input string.
 * Same input always returns same color.
 *
 * @param {string} str - String to hash (e.g., unit name, type name)
 * @returns {string} - Tailwind class string for badge coloring
 *
 * @example
 * getHashColor('Medicine PS1') // Returns "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
 */
export function getHashColor(str) {
  if (!str) return 'bg-muted text-muted-foreground';
  const index = simpleHash(str) % BADGE_COLORS.length;
  const color = BADGE_COLORS[index];
  return `${color.bg} ${color.darkBg} ${color.text} ${color.darkText}`;
}
