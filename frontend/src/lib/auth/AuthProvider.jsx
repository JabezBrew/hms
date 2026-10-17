import { AuthContext } from './AuthContext.js'
import { useAuthProviderController } from './useAuthProviderController.js'
import { IdentityVerificationLoader } from '@/features/auth/IdentityVerificationLoader'
import { isRustV2ApiMode } from '@/lib/api/v2/runtime'
import { authorizationIdentity } from '@/shared/lib/authorizationScope'

export function AuthProvider({ children }) {
  const value = useAuthProviderController()

  return <AuthContext.Provider value={value}>{isRustV2ApiMode() && value.user && <IdentityVerificationLoader key={authorizationIdentity(value.user)} />}{children}</AuthContext.Provider>
}
