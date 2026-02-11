import { useEffect, useState } from 'react'

function readVisibility() {
  if (typeof document === 'undefined') {
    return true
  }
  return document.visibilityState === 'visible'
}

function readFocus() {
  if (typeof document === 'undefined') {
    return true
  }
  return typeof document.hasFocus === 'function' ? document.hasFocus() : true
}

/**
 * Tracks whether the page is both visible and focused.
 * Use to suppress background polling/network work on hidden tabs.
 */
export function usePageVisibility() {
  const [isVisible, setIsVisible] = useState(readVisibility)
  const [isFocused, setIsFocused] = useState(readFocus)

  useEffect(() => {
    const handleVisibility = () => setIsVisible(readVisibility())
    const handleFocus = () => setIsFocused(true)
    const handleBlur = () => setIsFocused(false)

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  return {
    isVisible,
    isFocused,
    isPageActive: isVisible && isFocused,
  }
}
