import { useState, useEffect, useMemo, useContext, createContext, useRef, useCallback } from 'react'

import { authApi } from "./api/auth"
import { notifications } from "./notifications"
import { setAuthTokenProvider } from "./api-client"
import { queryClient } from './react-query'

// Create an authentication context
const AuthContext = createContext(undefined)

// Authentication provider component
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
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

  // Logout function - defined early to avoid circular dependency
  const logout = async (localOnly = false) => {
    try {
      if (!localOnly) {
        try {
          await authApi.logout()
        } catch (error) {
          // Suppress errors during logout - token may already be expired
          // Still proceed with local cleanup
        }
      }

      // Clear all session data
      localStorage.removeItem("user")
      localStorage.removeItem("sessionStartTime")
      localStorage.removeItem("refreshTokenIssuedAt")
      setUser(null)
      setAccessToken(null)

      // Clear the React Query cache when logging out
      queryClient.clear()

      if (!localOnly) {
        notifications.success("Logged out successfully")
      }
    } catch (error) {
      // Always proceed with local cleanup even if logout fails
      localStorage.removeItem("user")
      localStorage.removeItem("sessionStartTime")
      localStorage.removeItem("refreshTokenIssuedAt")
      setUser(null)
      setAccessToken(null)
      queryClient.clear()
    }
  }

  // Function to check if session is still valid
  const isSessionValid = useCallback(() => {
    const refreshTokenIssuedAt = localStorage.getItem("refreshTokenIssuedAt")
    const sessionStartTime = localStorage.getItem("sessionStartTime")

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

  // Function to refresh the access token
  const refreshAccessToken = useCallback(async () => {
    try {
      // Check if session is still valid before attempting refresh
      if (!isSessionValid()) {
        await logout(true)
        notifications.info("Your session has expired. Please log in again.")
        return null
      }

      const response = await authApi.refreshToken()
      setAccessToken(response.access)

      // Update refresh token issued time on successful refresh
      // (backend rotates refresh tokens)
      localStorage.setItem("refreshTokenIssuedAt", Date.now().toString())

      return response.access
    } catch (error) {
      // If refresh fails, perform a local-only logout to avoid API call loops
      await logout(true)
      return null
    }
  }, [isSessionValid])

  // Flag to track if user just logged in
  const justLoggedInRef = useRef(false)

  // Check if user is already logged in on mount
  useEffect(() => {
    const initializeAuth = async () => {
      const storedUser = localStorage.getItem("user")
      if (storedUser) {
        try {
          const userData = JSON.parse(storedUser)

          // Validate session before restoring user
          if (!isSessionValid()) {
            // Session expired, clear everything
            localStorage.removeItem("user")
            localStorage.removeItem("sessionStartTime")
            localStorage.removeItem("refreshTokenIssuedAt")
            setLoading(false)
            return
          }

          setUser(userData)
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
        } catch (e) {
          // Failed to parse stored user
          localStorage.removeItem("user")
          localStorage.removeItem("sessionStartTime")
          localStorage.removeItem("refreshTokenIssuedAt")
        }
      }
      setLoading(false)
    }

    initializeAuth()
  }, [isSessionValid, refreshAccessToken])

  // Connect auth context to api-client
  useEffect(() => {
    setAuthTokenProvider(getAccessToken, refreshAccessToken)
  }, [getAccessToken, refreshAccessToken])

  // Login function
  const login = async (email, password) => {
    setError(null)
    try {
      // Call the login API
      const response = await authApi.login(email, password)

      // Store access token in memory
      setAccessToken(response.access)

      // Store session timing data
      const now = Date.now().toString()
      localStorage.setItem("sessionStartTime", now)
      localStorage.setItem("refreshTokenIssuedAt", now)

      // Store user data (without token) in localStorage
      const userData = {
        email: response.user.email,
        id: response.user.id,
        role: response.user.user_type, // Store the user's role
        // Include access context for off-site read-only mode
        accessContext: response.access_context || null,
      }
      localStorage.setItem("user", JSON.stringify(userData))
      setUser(userData)

      // Set the flag to indicate user just logged in
      justLoggedInRef.current = true

      // Reset the flag after 5 seconds
      setTimeout(() => {
        justLoggedInRef.current = false
      }, 5000)

      return userData
    } catch (error) {
      const errorMessage = error.message || "Failed to login"
      setError(errorMessage)
      notifications.error(errorMessage)
      throw error
    }
  }

  // Register function
  const register = async (name, email, password) => {
    setLoading(true)
    setError(null)
    try {
      // Call the register API
      const response = await authApi.register(name, email, password)

      // Store access token in memory
      setAccessToken(response.access)

      // Store session timing data
      const now = Date.now().toString()
      localStorage.setItem("sessionStartTime", now)
      localStorage.setItem("refreshTokenIssuedAt", now)

      // Store user data (without token) in localStorage
      const userData = {
        email: response.user.email,
        id: response.user.id,
        name: response.user.name,
        role: response.user.user_type, // Store the user's role
      }
      localStorage.setItem("user", JSON.stringify(userData))
      setUser(userData)
      return userData
    } catch (error) {
      const errorMessage = error.message || "Failed to register"
      setError(errorMessage)
      notifications.error(errorMessage)
      throw error
    } finally {
      setLoading(false)
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

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      login,
      register,
      logout,
      resetPassword,
      getAccessToken,
      refreshAccessToken,
      isSessionValid,
      isAuthenticated: !!user,
    }),
    [user, loading, error, getAccessToken, refreshAccessToken, isSessionValid]
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
