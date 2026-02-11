import { useCallback, useMemo, useState } from 'react'

export function useListFilters({
  initialSearch = '',
  initialStatus = 'all',
  initialDate = '',
  initialPage = 1,
  pageSize = 10,
} = {}) {
  const [search, setSearch] = useState(initialSearch)
  const [status, setStatus] = useState(initialStatus)
  const [date, setDate] = useState(initialDate)
  const [page, setPage] = useState(initialPage)

  const updateSearch = useCallback((value) => {
    setSearch(value)
    setPage(1)
  }, [])

  const updateStatus = useCallback((value) => {
    setStatus(value)
    setPage(1)
  }, [])

  const updateDate = useCallback((value) => {
    setDate(value)
    setPage(1)
  }, [])

  const clearFilters = useCallback(() => {
    setSearch('')
    setStatus(initialStatus)
    setDate('')
    setPage(1)
  }, [initialStatus])

  const hasActiveFilters = useMemo(
    () => Boolean(search) || (status && status !== 'all') || Boolean(date),
    [search, status, date],
  )

  return {
    search,
    status,
    date,
    page,
    pageSize,
    setPage,
    updateSearch,
    updateStatus,
    updateDate,
    clearFilters,
    hasActiveFilters,
  }
}
