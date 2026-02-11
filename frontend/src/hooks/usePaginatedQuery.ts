import { useInfiniteQuery } from '@tanstack/react-query';

/**
 * A hook for handling paginated queries
 * @param {Array} queryKey - Base query key
 * @param {Function} queryFn - Function to fetch paginated data
 * @param {Object} options - Additional options
 * @returns {Object} Infinite query result
 */
export function usePaginatedQuery(queryKey, queryFn, options = {}) {
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam = 1 }) => queryFn({ page: pageParam, ...options.params }),
    getNextPageParam: (lastPage) => {
      // If there's a next page URL, extract the page number
      if (lastPage.next) {
        const url = new URL(lastPage.next);
        return url.searchParams.get('page');
      }
      return undefined; // No more pages
    },
    getPreviousPageParam: (firstPage) => {
      // If there's a previous page URL, extract the page number
      if (firstPage.previous) {
        const url = new URL(firstPage.previous);
        return url.searchParams.get('page');
      }
      return undefined; // No previous pages
    },
    ...options
  });
}