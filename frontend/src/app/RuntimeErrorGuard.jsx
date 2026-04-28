import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

import AppFailureState from '@/app/AppFailureState'
import {
  isChunkLoadError,
  normalizeRuntimeError,
  publishRuntimeDiagnostics,
} from '@/lib/runtime-diagnostics'

function isAssetScriptLoadError(event) {
  const target = event?.target
  if (!target || target?.tagName !== 'SCRIPT') {
    return false
  }

  return /\/assets\/.+\.js(?:\?.*)?$/i.test(target.src || '')
}

function getLocationSnapshot(location) {
  return {
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    host: globalThis?.window?.location?.host,
  }
}

function buildChunkLoadFailure(event, appState, location) {
  const error = isAssetScriptLoadError(event)
    ? normalizeRuntimeError(
        `Failed to load a required frontend asset: ${event.target?.src || 'unknown chunk'}`,
        'Failed to load a required frontend asset',
      )
    : normalizeRuntimeError(event?.reason ?? event?.error ?? event?.message)

  const diagnostics = publishRuntimeDiagnostics({
    appState,
    location: getLocationSnapshot(location),
  })
  return { diagnostics, error }
}

export default function RuntimeErrorGuard({ appState, children }) {
  const location = useLocation()
  const [failure, setFailure] = useState(null)

  useEffect(() => {
    publishRuntimeDiagnostics({
      appState,
      location: getLocationSnapshot(location),
    })
  }, [appState, location])

  useEffect(() => {
    const handleWindowError = (event) => {
      if (!isAssetScriptLoadError(event) && !isChunkLoadError(event?.error ?? event?.message)) {
        return
      }

      event.preventDefault?.()
      const nextFailure = buildChunkLoadFailure(event, appState, location)
      console.error('Frontend chunk load failure', nextFailure)
      setFailure(nextFailure)
    }

    const handleUnhandledRejection = (event) => {
      if (!isChunkLoadError(event?.reason)) {
        return
      }

      event.preventDefault?.()
      const nextFailure = buildChunkLoadFailure(event, appState, location)
      console.error('Frontend chunk load rejection', nextFailure)
      setFailure(nextFailure)
    }

    globalThis?.window?.addEventListener('error', handleWindowError)
    globalThis?.window?.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      globalThis?.window?.removeEventListener('error', handleWindowError)
      globalThis?.window?.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [appState, location])

  if (failure) {
    return (
      <AppFailureState
        title="Frontend update required"
        description="A required HMS code bundle failed to load. Reload the app to sync with the latest frontend assets."
        error={failure.error}
        diagnostics={failure.diagnostics}
        onPrimaryAction={() => globalThis?.window?.location?.reload()}
      />
    )
  }

  return children
}
