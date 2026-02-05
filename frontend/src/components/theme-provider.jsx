import { useMemo, useState, useContext, useEffect, createContext } from 'react'
import { safeStorage } from '@/lib/safe-storage'

const ThemeContext = createContext({
  theme: "light",
  setTheme: () => null,
})

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() =>
    safeStorage.get("theme", "light")
  )

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove("light", "dark")
    root.classList.add(theme)
    safeStorage.set("theme", theme)
  }, [theme])

  const value = useMemo(
    () => ({
      theme,
      setTheme: (newTheme) => setTheme(newTheme),
      toggleTheme: () => setTheme(theme === "light" ? "dark" : "light"),
    }),
    [theme]
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