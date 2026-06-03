import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export function useListFilters({
  initialSearch = '',
  initialStatus = 'all',
  initialDate = '',
  initialPage = 1,
  pageSize = 10,
  persistKey = null,
} = {}) {
  const location = useLocation()
  const navigate = useNavigate()
  const locationStateRef = useRef(location.state || {})
  const persisted = persistKey ? location.state?.[persistKey] : null
  const [search, setSearch] = useState(() => persisted?.search ?? initialSearch)
  const [status, setStatus] = useState(() => persisted?.status ?? initialStatus)
  const [date, setDate] = useState(() => persisted?.date ?? initialDate)
  const [page, setPageState] = useState(() => persisted?.page ?? initialPage)

  useEffect(() => {
    locationStateRef.current = location.state || {}
  }, [location.state])

  const persistState = useCallback((changes) => {
    if (!persistKey) return
    const nextState = {
      ...locationStateRef.current,
      [persistKey]: {
        ...(locationStateRef.current?.[persistKey] || {}),
        ...changes,
      },
    }
    locationStateRef.current = nextState
    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: nextState,
      preventScrollReset: true,
    })
  }, [location.pathname, location.search, navigate, persistKey])

  const updateSearch = useCallback((value) => {
    setSearch(value)
    setPageState(1)
    persistState({ search: value, page: 1 })
  }, [persistState])

  const updateStatus = useCallback((value) => {
    setStatus(value)
    setPageState(1)
    persistState({ status: value, page: 1 })
  }, [persistState])

  const updateDate = useCallback((value) => {
    setDate(value)
    setPageState(1)
    persistState({ date: value, page: 1 })
  }, [persistState])

  const setPage = useCallback((value) => {
    setPageState((current) => {
      const nextPage = typeof value === 'function' ? value(current) : value
      persistState({ page: nextPage })
      return nextPage
    })
  }, [persistState])

  const clearFilters = useCallback(() => {
    setSearch('')
    setStatus(initialStatus)
    setDate('')
    setPageState(1)
    persistState({
      search: '',
      status: initialStatus,
      date: '',
      page: 1,
    })
  }, [initialStatus, persistState])

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
