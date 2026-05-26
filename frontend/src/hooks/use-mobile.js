import { useSyncExternalStore } from 'react'


const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
      mql.addEventListener("change", notify)
      return () => mql.removeEventListener("change", notify)
    },
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false
  )
}
