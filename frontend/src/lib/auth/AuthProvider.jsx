import { Suspense } from 'react'
import PublicAuthLoader from '@/app/PublicAuthLoader'
import { authSessionRuntime } from './authSessionLoader'

const SessionProvider = authSessionRuntime(() => import('./AuthSessionProvider'))

// The module-scope runtime stays mounted through every session transition.
// No auth consumer or protected child mounts while the real provider loads.
export function AuthProvider({ children, Runtime = SessionProvider }) {
  return <Suspense fallback={<PublicAuthLoader />}><Runtime>{children}</Runtime></Suspense>
}
