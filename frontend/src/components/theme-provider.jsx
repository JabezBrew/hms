import { useCallback, useMemo, useState, useContext, useEffect, createContext } from 'react'
import { safeStorage } from '@/lib/safe-storage'

const ThemeContext = createContext(undefined)
const isTheme = (value) => ['light', 'dark', 'system'].includes(value)
const systemQuery = '(prefers-color-scheme: dark)'

function readSystemTheme() {
  return typeof window.matchMedia === 'function' && window.matchMedia(systemQuery).matches
    ? 'dark'
    : 'light'
}

export function ThemeProvider({ children }) {
  const [theme, updateTheme] = useState(() => {
    const stored = safeStorage.get('theme', 'light')
    return isTheme(stored) ? stored : 'light'
  })
  const [systemTheme, setSystemTheme] = useState(readSystemTheme)
  const resolvedTheme = theme === 'system' ? systemTheme : theme

  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia(systemQuery)
    const onChange = () => setSystemTheme(media.matches ? 'dark' : 'light')
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove("light", "dark")
    root.classList.add(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    safeStorage.set("theme", theme)
  }, [theme])

  const setTheme = useCallback((nextTheme) => {
    if (isTheme(nextTheme)) updateTheme(nextTheme)
  }, [])
  const toggleTheme = useCallback(() => {
    updateTheme((current) => (current === 'system' ? readSystemTheme() : current) === 'light' ? 'dark' : 'light')
  }, [])

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
    }),
    [theme, resolvedTheme, setTheme, toggleTheme]
  )

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}
