import * as React from 'react'

export const OmniSearchContext = React.createContext(null)

export function useOmniSearch() {
  const ctx = React.useContext(OmniSearchContext)
  if (!ctx) {
    throw new Error('useOmniSearch must be used within an OmniSearchProvider')
  }
  return ctx
}
