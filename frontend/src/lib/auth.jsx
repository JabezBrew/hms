import { useState, useEffect, useMemo, useContext, createContext, useRef, useCallback } from 'react'
import { getAuthValue, removeAuthValue, setAuthValue } from '@/lib/auth-storage'

import { authApi } from "./api/auth"
import { notifications } from "./notifications"
import { setAuthTokenProvider, setFacilityCodeProvider, performTokenRefresh } from "./api-client"
import { queryClient } from './react-query'

// Create an authentication context
const AuthContext = createContext(undefined)

// Authentication provider component
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [facilityCode, setFacilityCodeState] = useState(null)
  const [mfaSession, setMfaSession] = useState(null)
  const [mfaUser, setMfaUser] = useState(null)
  const [mfaEnrollmentRequired, setMfaEnrollmentRequired] = useState(false)
  const [mfaAvailableMethods, setMfaAvailableMethods] = useState(null)
  const defaultFacilityCode = import.meta.env.VITE_DEFAULT_FACILITY_CODE || null
  // Store access token in memory (not in localStorage)
  const accessTokenRef = useRef(null)

  // Function to get the current access token
  const getAccessToken = useCallback(() => {
    return accessTokenRef.current
  }, [])

  // Function to set the access token
  const setAccessToken = useCallback((token) => {
    accessTokenRef.current = token
  }, [])

  const setFacilityCode = useCallback((code) => {
    const normalized = code ? String(code).toUpperCase() : null
    setFacilityCodeState(normalized)
    queryClient.clear()
    if (user) {
      const updatedUser = { ...user, facilityCode: normalized }
      setAuthValue("user", JSON.stringify(updatedUser))
      setUser(updatedUser)
    } else if (mfaUser) {
      setMfaUser({ ...mfaUser, facilityCode: normalized })
    }
  }, [user, mfaUser])

  // Logout function - defined early to avoid circular dependency
  const logout = useCallback(async (localOnly = false) => {
    try {
      if (!localOnly) {
        try {
          await authApi.logout()
        } catch (_error) {
          // Suppress errors during logout - token may already be expired
          // Still proceed with local cleanup
        }
      }

      // Clear all session data
      removeAuthValue("user")
      removeAuthValue("sessionStartTime")
      removeAuthValue("refreshTokenIssuedAt")
      setUser(null)
      setAccessToken(null)
      setFacilityCodeState(null)
      setMfaSession(null)
      setMfaUser(null)
      setMfaEnrollmentRequired(false)
      setMfaAvailableMethods(null)

      // Clear the React Query cache when logging out
      queryClient.clear()

      if (!localOnly) {
        notifications.success("Logged out successfully")
      }
    } catch (_error) {
      // Always proceed with local cleanup even if logout fails
      removeAuthValue("user")
      removeAuthValue("sessionStartTime")
      removeAuthValue("refreshTokenIssuedAt")
      setUser(null)
      setAccessToken(null)
      setFacilityCodeState(null)
      setMfaSession(null)
      setMfaUser(null)
      setMfaEnrollmentRequired(false)
      setMfaAvailableMethods(null)
      queryClient.clear()
    }
  }, [setAccessToken])

  // Function to check if session is still valid
  const isSessionValid = useCallback(() => {
    const refreshTokenIssuedAt = getAuthValue("refreshTokenIssuedAt")
    const sessionStartTime = getAuthValue("sessionStartTime")

    if (!refreshTokenIssuedAt || !sessionStartTime) {
      return false
    }

    const now = Date.now()
    const issuedAt = parseInt(refreshTokenIssuedAt, 10)
    const startTime = parseInt(sessionStartTime, 10)

    // Check if refresh token has expired (7 days)
    const REFRESH_TOKEN_LIFETIME = 7 * 24 * 60 * 60 * 1000 // 7 days
    if (now - issuedAt > REFRESH_TOKEN_LIFETIME) {
      return false
    }

    // Check absolute session timeout (8 hours)
    const ABSOLUTE_SESSION_TIMEOUT = 8 * 60 * 60 * 1000 // 8 hours
    if (now - startTime > ABSOLUTE_SESSION_TIMEOUT) {
      return false
    }

    return true
  }, [])

  // Handler for when refresh fails - called by api-client
  const handleRefreshFailure = useCallback(async () => {
    await logout(true)
    notifications.info("Your session has expired. Please log in again.")
  }, [logout])

  // Function to refresh the access token - uses centralized refresh from api-client
  const refreshAccessToken = useCallback(async () => {
    // Check if session is still valid before attempting refresh
    if (!isSessionValid()) {
      await handleRefreshFailure()
      return null
    }

    // Use centralized refresh - this ensures only one refresh request at a time
    const newToken = await performTokenRefresh()

    if (newToken) {
      // Update refresh token issued time on successful refresh
      // (backend rotates refresh tokens)
      setAuthValue("refreshTokenIssuedAt", Date.now().toString())
    }

    return newToken
  }, [isSessionValid, handleRefreshFailure])

  // Flag to track if user just logged in
  const justLoggedInRef = useRef(false)

  // Check if user is already logged in on mount
  useEffect(() => {
    const initializeAuth = async () => {
      const storedUser = getAuthValue("user")
      if (storedUser) {
        try {
          const userData = JSON.parse(storedUser)

          // Validate session before restoring user
          if (!isSessionValid()) {
            // Session expired, clear everything
            removeAuthValue("user")
            removeAuthValue("sessionStartTime")
            removeAuthValue("refreshTokenIssuedAt")
            setLoading(false)
            return
          }

          setUser(userData)
          setFacilityCodeState(userData.facilityCode || defaultFacilityCode)
          // Only refresh token if user wasn't just logged in AND we don't have a token
          if (!justLoggedInRef.current && !accessTokenRef.current) {
            // IMPORTANT: Wait for token refresh before setting loading=false
            // This prevents API calls from firing before we have an access token
            try {
              await refreshAccessToken()
            } catch {
              // Silent fail - user will be redirected to login if needed
            }
          }
        } catch (_e) {
          // Failed to parse stored user
          removeAuthValue("user")
          removeAuthValue("sessionStartTime")
          removeAuthValue("refreshTokenIssuedAt")
        }
      }
      setLoading(false)
    }

    initializeAuth()
  }, [isSessionValid, refreshAccessToken])

  // Connect auth context to api-client
  useEffect(() => {
    setAuthTokenProvider(getAccessToken, setAccessToken, handleRefreshFailure)
    setFacilityCodeProvider(() => facilityCode)
  }, [getAccessToken, setAccessToken, handleRefreshFailure, facilityCode])

  // Login function
  const applyAuthResponse = useCallback((response) => {
    if (!response?.access || !response?.user) {
      return null
    }

    setAccessToken(response.access)

    const now = Date.now().toString()
    setAuthValue("sessionStartTime", now)
    setAuthValue("refreshTokenIssuedAt", now)

    const userData = {
      email: response.user.email,
      id: response.user.id,
      role: response.user.user_type,
      firstName: response.user.first_name,
      lastName: response.user.last_name,
      staffId: response.user.staff_id || null,
      practitionerId: response.user.practitioner_id || null,
      facilityCode: response.user.facility_code || defaultFacilityCode,
      accessContext: response.access_context || null,
    }
    setAuthValue("user", JSON.stringify(userData))
    setUser(userData)
    setFacilityCodeState(userData.facilityCode || null)

    setMfaSession(null)
    setMfaUser(null)
    setMfaEnrollmentRequired(false)
    setMfaAvailableMethods(null)

    justLoggedInRef.current = true
    setTimeout(() => {
      justLoggedInRef.current = false
    }, 5000)

    return userData
  }, [defaultFacilityCode, setAccessToken])

  const login = async (email, password, facility) => {
    setError(null)
    try {
      // Call the login API
      const response = await authApi.login(email, password, facility)

      if (response?.mfa_required) {
        setMfaSession(response.mfa_session)
        setMfaUser(response.user || null)
        setMfaEnrollmentRequired(Boolean(response.mfa?.enrollment_required))
        setMfaAvailableMethods(response.mfa || null)
        if (response.user?.facility_code || facility) {
          setFacilityCode(response.user?.facility_code || facility)
        }
        return { mfaRequired: true }
      }

      return applyAuthResponse(response)
    } catch (error) {
      const errorMessage = error.message || "Failed to login"
      setError(errorMessage)
      notifications.error(errorMessage)
      throw error
    }
  }

  // Reset password function
  const resetPassword = async (email) => {
    setLoading(true)
    setError(null)
    try {
      // Call the reset password API
      await authApi.requestPasswordReset(email)
      return true
    } catch (error) {
      const errorMessage = error.message || "Failed to reset password"
      setError(errorMessage)
      notifications.error(errorMessage)
      throw error
    } finally {
      setLoading(false)
    }
  }

  const completeMfa = useCallback((response) => applyAuthResponse(response), [applyAuthResponse])

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      login,
      completeMfa,
      logout,
      resetPassword,
      facilityCode,
      setFacilityCode,
      getAccessToken,
      refreshAccessToken,
      isSessionValid,
      mfaSession,
      mfaUser,
      mfaEnrollmentRequired,
      mfaAvailableMethods,
      isAuthenticated: !!user,
    }),
    [
      user,
      loading,
      error,
      facilityCode,
      setFacilityCode,
      getAccessToken,
      refreshAccessToken,
      isSessionValid,
      mfaSession,
      mfaUser,
      mfaEnrollmentRequired,
      mfaAvailableMethods,
      completeMfa,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Custom hook to use the auth context
export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
