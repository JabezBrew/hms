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
 * normalizeApiResults({patients: [{id: 1}]}, 'patients') // Custom key
 */
export function normalizeApiResults(data, arrayKey = 'results') {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data[arrayKey] && Array.isArray(data[arrayKey])) return data[arrayKey];
  if (data.patients && Array.isArray(data.patients)) return data.patients;
  return [];
}
