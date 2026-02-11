import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from './use-debounce';

/**
 * A hook for handling search queries with debounce
 * @param {Array} queryKey - Base query key
 * @param {Function} queryFn - Function to fetch data based on search term
 * @param {Object} options - Additional options
 * @returns {Object} Query result with search state
 */
export function useSearchQuery(queryKey, queryFn, options = {}) {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, options.debounceMs || 300);

  const enabled =
    !!debouncedSearchTerm &&
    (typeof debouncedSearchTerm === 'string'
      ? debouncedSearchTerm.length >= (options.minLength || 2)
      : true);

  const query = useQuery({
    queryKey: [...queryKey, debouncedSearchTerm],
    queryFn: () => queryFn(debouncedSearchTerm),
    enabled,
    staleTime: options.staleTime || 60 * 1000, // 1 minute by default
    ...options
  });

  return {
    ...query,
    searchTerm,
    setSearchTerm,
    debouncedSearchTerm
  };
}