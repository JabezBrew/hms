import * as React from 'react'
import { useLocation } from 'react-router-dom'

import { safeStorage } from '@/lib/safe-storage'
import { useAuth } from '@/lib/auth'

import { OmniSearchContext } from './OmniSearchContext'
import {
  getStaticPathLabelMapForRole,
  getStaticPathSetForRole,
} from './pageIndex'

const STORAGE_KEY = 'omni_recent_pages'
const MAX_RECENT_PAGES = 8
const DRAFT_QUERY_TTL_MS = 10 * 60 * 1000
const OmniSearchDialog = React.lazy(() =>
  import('./OmniSearchDialog').then((module) => ({ default: module.OmniSearchDialog }))
)

function normalizeRecentPages(value) {
  if (!Array.isArray(value)) return []

  const out = []
  const seen = new Set()
  for (const item of value) {
    const path = item?.path
    const label = item?.label
    const ts = item?.ts
    if (typeof path !== 'string' || !path.startsWith('/')) continue
    if (path.includes(':')) continue
    if (typeof label !== 'string' || label.length === 0) continue
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue
    if (seen.has(path)) continue
    seen.add(path)
    out.push({ path, label, ts })
    if (out.length >= MAX_RECENT_PAGES) break
  }
  return out
}

export function OmniSearchProvider({ children }) {
  const { user, facilityCode } = useAuth()
  const role = user?.role || ''
  const userId = user?.id || null

  const location = useLocation()
  const staticPaths = React.useMemo(() => getStaticPathSetForRole(role), [role])
  const labelMap = React.useMemo(() => getStaticPathLabelMapForRole(role), [role])

  const [open, setOpenState] = React.useState(false)
  const [dialogMounted, setDialogMounted] = React.useState(false)
  const [recentPages, setRecentPages] = React.useState(() =>
    normalizeRecentPages(safeStorage.getJSON(STORAGE_KEY, []))
  )
  const [draftQuery, setDraftQueryState] = React.useState({ value: '', ts: 0 })

  const clearDraftQuery = React.useCallback(() => {
    setDraftQueryState({ value: '', ts: 0 })
  }, [])

  const setDraftQuery = React.useCallback((value) => {
    setDraftQueryState({
      value: String(value || ''),
      ts: Date.now(),
    })
  }, [])

  const visibleDraftQuery = React.useMemo(() => {
    if (!draftQuery.value || !draftQuery.ts) return ''
    if (open) return draftQuery.value
    if (Date.now() - draftQuery.ts > DRAFT_QUERY_TTL_MS) return ''
    return draftQuery.value
  }, [draftQuery, open])

  const setOpen = React.useCallback((nextOpen) => {
    if (nextOpen) {
      setDialogMounted(true)
    }
    setOpenState(nextOpen)
  }, [])
  const openDialog = React.useCallback(() => setOpen(true), [setOpen])
  const closeDialog = React.useCallback(() => setOpen(false), [setOpen])

  React.useEffect(() => {
    const onKeyDown = (e) => {
      if (e.defaultPrevented || e.isComposing) return
      if (e.key !== 'k' && e.key !== 'K') return
      if (!e.metaKey && !e.ctrlKey) return
      e.preventDefault()
      setOpen(!open)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen])

  React.useEffect(() => {
    clearDraftQuery()
  }, [clearDraftQuery, facilityCode, role, userId])

  React.useEffect(() => {
    if (!draftQuery.value || !draftQuery.ts) return undefined
    if (open) return undefined
    const remaining = Math.max(0, DRAFT_QUERY_TTL_MS - (Date.now() - draftQuery.ts))
    const id = window.setTimeout(clearDraftQuery, remaining)
    return () => window.clearTimeout(id)
  }, [clearDraftQuery, draftQuery, open])

  React.useEffect(() => {
    const path = location?.pathname
    if (!path) return
    if (!staticPaths.has(path)) return

    const label = labelMap.get(path) || path
    const entry = { path, label, ts: Date.now() }

    setRecentPages((prev) => {
      const next = [entry, ...prev.filter((p) => p?.path !== path)].slice(0, MAX_RECENT_PAGES)
      safeStorage.setJSON(STORAGE_KEY, next)
      return next
    })
  }, [location?.pathname, staticPaths, labelMap])

  const value = React.useMemo(
    () => ({
      open,
      setOpen,
      openDialog,
      closeDialog,
      clearDraftQuery,
      draftQuery: visibleDraftQuery,
      recentPages,
      setDraftQuery,
    }),
    [open, setOpen, openDialog, closeDialog, clearDraftQuery, visibleDraftQuery, recentPages, setDraftQuery]
  )

  return (
    <OmniSearchContext.Provider value={value}>
      {children}
      {dialogMounted && (
        <React.Suspense fallback={null}>
          <OmniSearchDialog />
        </React.Suspense>
      )}
    </OmniSearchContext.Provider>
  )
}
