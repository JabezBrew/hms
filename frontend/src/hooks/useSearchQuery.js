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
  const {
    debounceMs = 300,
    minLength = 2,
    queryKeyForTerm,
    staleTime = 60 * 1000,
    ...queryOptions
  } = options;
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, debounceMs);

  const enabled =
    !!debouncedSearchTerm &&
    (typeof debouncedSearchTerm === 'string'
      ? debouncedSearchTerm.length >= minLength
      : true);

  const query = useQuery({
    queryKey: [...queryKey, queryKeyForTerm ? queryKeyForTerm(debouncedSearchTerm) : debouncedSearchTerm],
    queryFn: ({ signal }) => queryFn(debouncedSearchTerm, { signal }),
    enabled,
    staleTime,
    ...queryOptions
  });

  return {
    ...query,
    searchTerm,
    setSearchTerm,
    debouncedSearchTerm
  };
}
