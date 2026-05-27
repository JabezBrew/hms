import { AuthContext } from './AuthContext.js'
import { useAuthProviderController } from './useAuthProviderController.js'

export function AuthProvider({ children }) {
  const value = useAuthProviderController()

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
