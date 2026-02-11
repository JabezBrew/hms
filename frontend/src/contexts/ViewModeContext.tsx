import { createContext, useContext, useState, useEffect } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { safeStorage } from '@/lib/safe-storage'

export const VIEW_MODES = {
  DOCUMENTATION: 'documentation',
  REVIEW: 'review',
  MONITORING: 'monitoring',
} as const

export type ViewMode = (typeof VIEW_MODES)[keyof typeof VIEW_MODES]

export interface ViewModeContextValue {
  viewMode: ViewMode
  setViewMode: Dispatch<SetStateAction<ViewMode>>
  isDocumentationMode: boolean
  isReviewMode: boolean
  isMonitoringMode: boolean
}

const ViewModeContext = createContext<ViewModeContextValue | undefined>(undefined)

function isViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && Object.values(VIEW_MODES).includes(value as ViewMode)
}

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    // Load from safe storage or default to documentation mode
    const stored = safeStorage.get('encounter_view_mode', VIEW_MODES.DOCUMENTATION)
    return isViewMode(stored) ? stored : VIEW_MODES.DOCUMENTATION
  })

  // Persist to safe storage when mode changes
  useEffect(() => {
    safeStorage.set('encounter_view_mode', viewMode)
  }, [viewMode])

  const value = {
    viewMode,
    setViewMode,
    isDocumentationMode: viewMode === VIEW_MODES.DOCUMENTATION,
    isReviewMode: viewMode === VIEW_MODES.REVIEW,
    isMonitoringMode: viewMode === VIEW_MODES.MONITORING,
  }

  return (
    <ViewModeContext.Provider value={value}>
      {children}
    </ViewModeContext.Provider>
  )
}

export function useViewMode(): ViewModeContextValue {
  const context = useContext(ViewModeContext)
  if (context === undefined) {
    throw new Error('useViewMode must be used within a ViewModeProvider')
  }
  return context
}
