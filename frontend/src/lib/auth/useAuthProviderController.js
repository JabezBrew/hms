/* oxlint-disable react-doctor/prefer-useReducer -- Auth state has independent concerns: token memory, MFA challenge state, facility scope, and session restore. A reducer would obscure existing tested transitions without adding a shared invariant. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getAuthValue, removeAuthValue, setAuthValue } from '@/lib/auth-storage'

import { authApi } from "../api/auth"
import { notifications } from "../notifications"
import { setAuthTokenProvider, setFacilityCodeProvider, performTokenRefresh } from "../api-client"
import { configureV2ApiClient, performV2TokenRefresh } from "../api/v2/session"
import { isRustV2ApiMode } from "../api/v2/runtime"
import { queryClient } from '../react-query'
import { getDefaultFacilityCode } from '../runtime-config'

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
const ABSOLUTE_SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000
const REFRESH_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const ACTIVITY_THROTTLE_MS = 5000
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click']
const PASSIVE_ACTIVITY_EVENTS = new Set(['scroll', 'touchstart', 'wheel'])

function parseStoredTimestamp(value) {
  if (!value) {
    return null
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseServerDeadline(value) {
  if (!value) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getStoredSessionStartTime() {
  return parseStoredTimestamp(getAuthValue("sessionStartTime"))
}

function getStoredLastActivityAt(sessionStartTime = getStoredSessionStartTime()) {
  return parseStoredTimestamp(getAuthValue("lastActivityAt")) || sessionStartTime
}

function isStoredSessionValid(now = Date.now()) {
  const refreshTokenIssuedAt = parseStoredTimestamp(getAuthValue("refreshTokenIssuedAt"))
  const sessionStartTime = getStoredSessionStartTime()

  if (!refreshTokenIssuedAt || !sessionStartTime) {
    return false
  }

  if (now - refreshTokenIssuedAt > REFRESH_TOKEN_LIFETIME_MS) {
    return false
  }

  const lastActivityAt = getStoredLastActivityAt(sessionStartTime)
  const localIdleExpiresAt = lastActivityAt + SESSION_IDLE_TIMEOUT_MS
  if (now >= localIdleExpiresAt) {
    return false
  }

  const serverIdleExpiresAt = parseServerDeadline(getAuthValue("sessionIdleExpiresAt"))
  if (serverIdleExpiresAt && now >= serverIdleExpiresAt) {
    return false
  }

  const absoluteExpiresAt = parseServerDeadline(getAuthValue("sessionAbsoluteExpiresAt"))
    || sessionStartTime + ABSOLUTE_SESSION_TIMEOUT_MS
  if (now >= absoluteExpiresAt) {
    return false
  }

  return true
}

function recordSessionActivity(now = Date.now()) {
  if (!isStoredSessionValid(now)) {
    return false
  }
  setAuthValue("lastActivityAt", now.toString())
  return true
}

function persistSessionTiming(response, now = Date.now(), options = {}) {
  const nowString = now.toString()
  setAuthValue("refreshTokenIssuedAt", nowString)
  if (options.recordActivity) {
    setAuthValue("lastActivityAt", nowString)
  }

  if (response?.session_idle_expires_at) {
    setAuthValue("sessionIdleExpiresAt", response.session_idle_expires_at)
  }
  if (response?.session_absolute_expires_at) {
    setAuthValue("sessionAbsoluteExpiresAt", response.session_absolute_expires_at)
  }
}

export function useAuthProviderController() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [facilityCode, setFacilityCodeState] = useState(null)
  const [mfaSession, setMfaSession] = useState(null)
  const [mfaUser, setMfaUser] = useState(null)
  const [mfaEnrollmentRequired, setMfaEnrollmentRequired] = useState(false)
  const [mfaAvailableMethods, setMfaAvailableMethods] = useState(null)
  const defaultFacilityCode = getDefaultFacilityCode()
  const accessTokenRef = useRef(null)
  const logoutPromiseRef = useRef(null)
  const justLoggedInRef = useRef(false)

  const getAccessToken = useCallback(() => {
    return isStoredSessionValid() ? accessTokenRef.current : null
  }, [])

  const setAccessToken = useCallback((token) => {
    accessTokenRef.current = token
  }, [])

  const clearCockpitCache = useCallback(async (reason) => {
    try {
      const { clearAllCockpitCaches } = await import('../cockpit-cache')
      await clearAllCockpitCaches({ reason })
    } catch {
      // Cockpit cache cleanup must never block auth state transitions.
    }
  }, [])

  const setFacilityCode = useCallback((code) => {
    const normalized = code ? String(code).toUpperCase() : null
    if (normalized !== facilityCode) {
      void clearCockpitCache('facility-change')
    }
    setFacilityCodeState(normalized)
    queryClient.clear()
    if (user) {
      const updatedUser = { ...user, facilityCode: normalized }
      setAuthValue("user", JSON.stringify(updatedUser))
      setUser(updatedUser)
    } else if (mfaUser) {
      setMfaUser({ ...mfaUser, facilityCode: normalized })
    }
  }, [clearCockpitCache, facilityCode, user, mfaUser])

  const clearPasswordChangeRequirement = useCallback(() => {
    setUser((currentUser) => {
      if (!currentUser || !currentUser.passwordChangeRequired) {
        return currentUser
      }
      const updatedUser = { ...currentUser, passwordChangeRequired: false }
      setAuthValue("user", JSON.stringify(updatedUser))
      return updatedUser
    })
  }, [])

  const clearLocalAuthState = useCallback(async (reason = 'auth-clear') => {
    removeAuthValue("user")
    removeAuthValue("sessionStartTime")
    removeAuthValue("lastActivityAt")
    removeAuthValue("refreshTokenIssuedAt")
    removeAuthValue("sessionIdleExpiresAt")
    removeAuthValue("sessionAbsoluteExpiresAt")
    setUser(null)
    setAccessToken(null)
    setFacilityCodeState(null)
    setMfaSession(null)
    setMfaUser(null)
    setMfaEnrollmentRequired(false)
    setMfaAvailableMethods(null)
    queryClient.clear()
    await clearCockpitCache(reason)
  }, [clearCockpitCache, setAccessToken])

  const notifyBackendLogout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // Session may already be invalid/expired; local cleanup still proceeds.
    }
  }, [])

  const logout = useCallback(async (localOnly = false, reason = 'logout') => {
    if (logoutPromiseRef.current) {
      return logoutPromiseRef.current
    }

    const logoutPromise = (async () => {
      if (!localOnly) {
        await notifyBackendLogout()
      }

      await clearLocalAuthState(reason)

      if (!localOnly) {
        notifications.success("Logged out successfully")
      }
    })()

    logoutPromiseRef.current = logoutPromise
    try {
      await logoutPromise
    } finally {
      logoutPromiseRef.current = null
    }
  }, [clearLocalAuthState, notifyBackendLogout])

  const isSessionValid = useCallback(() => {
    return isStoredSessionValid()
  }, [])

  const handleRefreshFailure = useCallback(async () => {
    await logout(false, 'session-expired')
    notifications.info("Your session has expired. Please log in again.")
  }, [logout])

  const refreshAccessToken = useCallback(async () => {
    if (!isSessionValid()) {
      await handleRefreshFailure()
      return null
    }

    const tokenResponse = isRustV2ApiMode()
      ? await performV2TokenRefresh({ notifyFailure: false })
      : null
    const newToken = isRustV2ApiMode()
      ? tokenResponse?.access_token
      : await performTokenRefresh()

    if (!newToken) {
      await handleRefreshFailure()
      return null
    }

    if (isRustV2ApiMode()) {
      persistSessionTiming(tokenResponse)
    } else {
      setAuthValue("refreshTokenIssuedAt", Date.now().toString())
    }

    return newToken
  }, [isSessionValid, handleRefreshFailure])

  useEffect(() => {
    const initializeAuth = async () => {
      const storedUser = getAuthValue("user")
      if (storedUser) {
        try {
          const userData = JSON.parse(storedUser)

          if (!isSessionValid()) {
            void notifyBackendLogout()
            await clearLocalAuthState('session-expired')
            setLoading(false)
            return
          }

          setUser(userData)
          setFacilityCodeState(userData.facilityCode || defaultFacilityCode)
          if (!justLoggedInRef.current && !accessTokenRef.current) {
            try {
              await refreshAccessToken()
            } catch {
              // Silent fail - user will be redirected to login if needed.
            }
          }
        } catch {
          void notifyBackendLogout()
          await clearLocalAuthState('auth-parse-error')
        }
      }
      setLoading(false)
    }

    initializeAuth()
  }, [clearLocalAuthState, defaultFacilityCode, isSessionValid, notifyBackendLogout, refreshAccessToken])

  useEffect(() => {
    setAuthTokenProvider(getAccessToken, setAccessToken, handleRefreshFailure)
    setFacilityCodeProvider(() => facilityCode)
    configureV2ApiClient({
      getAccessToken,
      setAccessToken,
      onRefreshFailure: handleRefreshFailure,
      getFacilityCode: () => facilityCode,
      canRefreshSession: isSessionValid,
    })
  }, [getAccessToken, setAccessToken, handleRefreshFailure, facilityCode, isSessionValid])

  useEffect(() => {
    if (!user) {
      return undefined
    }

    let lastActivityWriteAt = 0
    const recordActivity = () => {
      const now = Date.now()
      if (now - lastActivityWriteAt < ACTIVITY_THROTTLE_MS) {
        return
      }
      if (!recordSessionActivity(now)) {
        return
      }
      lastActivityWriteAt = now
    }

    recordActivity()
    ACTIVITY_EVENTS.forEach((event) => {
      const options = PASSIVE_ACTIVITY_EVENTS.has(event) ? { passive: true } : undefined
      window.addEventListener(event, recordActivity, options)
    })

    return () => {
      ACTIVITY_EVENTS.forEach((event) => {
        const options = PASSIVE_ACTIVITY_EVENTS.has(event) ? { passive: true } : undefined
        window.removeEventListener(event, recordActivity, options)
      })
    }
  }, [user])

  const applyAuthResponse = useCallback((response) => {
    if (!response?.access || !response?.user) {
      return null
    }

    setAccessToken(response.access)

    const now = Date.now().toString()
    setAuthValue("sessionStartTime", now)
    persistSessionTiming(response, Number.parseInt(now, 10), { recordActivity: true })

    const passwordChangeRequired = Boolean(
      response.password_change_required ?? response?.user?.must_change_password
    )

    const userData = {
      email: response.user.email,
      id: response.user.id,
      role: response.user.user_type,
      firstName: response.user.first_name,
      lastName: response.user.last_name,
      staffId: response.user.staff_id || null,
      practitionerId: response.user.practitioner_id || null,
      facilityCode: response.user.facility_code || defaultFacilityCode,
      adminAccess: response.user.admin_access || null,
      accessContext: response.access_context || null,
      passwordChangeRequired,
    }

    if (user?.id && user.id !== userData.id) {
      void clearCockpitCache('user-change')
    } else if (user?.role && user.role !== userData.role) {
      void clearCockpitCache('role-change')
    } else if (facilityCode && userData.facilityCode && facilityCode !== userData.facilityCode) {
      void clearCockpitCache('facility-change')
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

    try {
      sessionStorage.setItem('hms.pendingLoginToast', '1')
    } catch {
      // sessionStorage unavailable (private mode, SSR) - toaster will simply skip.
    }

    return userData
  }, [clearCockpitCache, defaultFacilityCode, facilityCode, setAccessToken, user])

  const login = useCallback(async (email, password, facility) => {
    setError(null)
    try {
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
  }, [applyAuthResponse, setFacilityCode])

  const resetPassword = useCallback(async (email) => {
    setLoading(true)
    setError(null)
    try {
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
  }, [])

  const completeMfa = useCallback((response) => applyAuthResponse(response), [applyAuthResponse])

  return useMemo(
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
      passwordChangeRequired: Boolean(user?.passwordChangeRequired),
      clearPasswordChangeRequirement,
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
      clearPasswordChangeRequirement,
      completeMfa,
      login,
      logout,
      resetPassword,
    ]
  )
}
