/* oxlint-disable react-doctor/prefer-useReducer -- Auth state has independent concerns: token memory, MFA challenge state, facility scope, and session restore. A reducer would obscure existing tested transitions without adding a shared invariant. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getAuthValue, removeAuthValue, setAuthValue } from '@/lib/auth-storage'

import { authApi, adaptV2AuthTokenResponse } from "../api/auth"
import { loginResult, sameSessionIdentity } from '@/features/auth/model'
import { getV2ClientScopeKey, getV2ClientScopeForToken, hasV2RefreshSessionHint } from '../api/v2/session'
import { currentConfirmedNetworkDecision } from '../api/v2/networkAccessGuard'
import { authorizationIdentity, requestAuthorizationScope } from '@/shared/lib/authorizationScope'
import { clearWorkflowContinuity, installWorkflowContinuity } from '@/shared/lib/workflowContinuity'
import { hashQueryValue } from '@/shared/lib/privateQueryKey'
import { providerUser } from '@/features/auth/providerUser'
import { networkKeys } from '@/features/settings/network/keys'
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
  const [pendingFactor, setPendingFactor] = useState(null)
  const factorRef = useRef(null)
  const authLifetime = useRef({ generation: 0, request: null, blocked: false })
  const cancelAuthOperation = useCallback(() => {
    clearWorkflowContinuity()
    authLifetime.current.generation += 1
    authLifetime.current.request?.abort()
    authLifetime.current.request = null
    factorRef.current = null
    setPendingFactor(null)
  }, [])
  useLayoutEffect(() => () => { authLifetime.current.generation += 1; authLifetime.current.request?.abort() }, [])

  const getAccessToken = useCallback(() => {
    return !authLifetime.current.blocked && isStoredSessionValid() ? accessTokenRef.current : null
  }, [])

  const setAccessToken = useCallback((token) => {
    if (token && authLifetime.current.blocked) return
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
      cancelAuthOperation()
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
  }, [cancelAuthOperation, clearCockpitCache, facilityCode, user, mfaUser])

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
      return true
    } catch {
      // Session may already be invalid/expired; local cleanup still proceeds.
      return false
    }
  }, [])

  const logout = useCallback(async (localOnly = false, reason = 'logout') => {
    if (logoutPromiseRef.current) {
      return logoutPromiseRef.current
    }
    cancelAuthOperation()

    const generation = authLifetime.current.generation
    const ending = !localOnly ? notifyBackendLogout() : Promise.resolve()
    authLifetime.current.blocked = true
    const logoutPromise = (async () => {
      await clearLocalAuthState(reason)
      const serverRetired = !localOnly && await ending === true
      if (!localOnly && generation === authLifetime.current.generation) {
        notifications.success("Logged out successfully")
      }
      return { serverRetired }
    })()

    logoutPromiseRef.current = logoutPromise
    try {
      await logoutPromise
    } finally {
      logoutPromiseRef.current = null
    }
  }, [cancelAuthOperation, clearLocalAuthState, notifyBackendLogout])

  const isSessionValid = useCallback(() => {
    return !authLifetime.current.blocked && isStoredSessionValid()
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
      const generation = authLifetime.current.generation
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

          if (authLifetime.current.blocked || authLifetime.current.generation !== generation) return
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

  const applyAuthResponse = useCallback((response, { sameSession = false } = {}) => {
    if (!response?.access || !response?.user) {
      return null
    }

    authLifetime.current.blocked = false
    setAccessToken(response.access)

    const now = Date.now().toString()
    if (!sameSession) {
      setAuthValue("sessionStartTime", now)
      persistSessionTiming(response, Number.parseInt(now, 10), { recordActivity: true })
    } else {
      if (response.session_idle_expires_at) setAuthValue('sessionIdleExpiresAt', response.session_idle_expires_at)
      if (response.session_absolute_expires_at) setAuthValue('sessionAbsoluteExpiresAt', response.session_absolute_expires_at)
    }

    const userData = providerUser(response, defaultFacilityCode)

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
      if (sameSession) return userData
      sessionStorage.setItem('hms.pendingLoginToast', '1')
    } catch {
      // sessionStorage unavailable (private mode, SSR) - toaster will simply skip.
    }

    return userData
  }, [clearCockpitCache, defaultFacilityCode, facilityCode, setAccessToken, user])

  const login = useCallback(async (email, password, facility, { setup = false } = {}) => {
    setError(null)
    if (isRustV2ApiMode()) {
      cancelAuthOperation()
      const controller = new AbortController()
      authLifetime.current.request = controller
      const generation = authLifetime.current.generation
      // Dispatch logout with the old identity before blocking its token getter.
      // A failed old-cookie retirement never advances to a new pending grant.
      const endOld = (logoutPromiseRef.current
        ? logoutPromiseRef.current.then((outcome) => outcome?.serverRetired ? undefined : authApi.logout({ signal: controller.signal }))
        : (accessTokenRef.current || getAuthValue('user') || hasV2RefreshSessionHint()) ? authApi.logout({ signal: controller.signal }) : Promise.resolve()).then(() => null, (failure) => failure)
      authLifetime.current.blocked = true
      await clearLocalAuthState('new-login')
      try {
        const logoutFailure = await endOld
        if (logoutFailure) throw new Error('The previous server session could not be ended. Retry sign-in after checking the connection.')
        if (controller.signal.aborted || generation !== authLifetime.current.generation) throw new DOMException('Aborted', 'AbortError')
        let response
        if (setup) {
          const { factorApi } = await import('@/features/auth/api')
          if (controller.signal.aborted || generation !== authLifetime.current.generation) throw new DOMException('Aborted', 'AbortError')
          response = await factorApi.startSetup({ email, password, facility_code: facility || defaultFacilityCode }, { signal: controller.signal })
        } else response = await authApi.login(email, password, facility, { signal: controller.signal })
        if (controller.signal.aborted || generation !== authLifetime.current.generation) throw new DOMException('Aborted', 'AbortError')
        if (['factor_required', 'setup_required'].includes(response?.status)) {
          factorRef.current = response; setPendingFactor(response)
          return { mfaRequired: true }
        }
        if (!response?.access || !response.user) throw new Error('Sign-in was not confirmed. Restart sign-in.')
        return applyAuthResponse(response)
      } catch (failure) {
        if (generation === authLifetime.current.generation && failure.name !== 'AbortError') { setError(failure.message || 'Sign-in failed.'); notifications.error('Sign-in could not be completed.') }
        throw failure
      } finally { if (authLifetime.current.request === controller) authLifetime.current.request = null }
    }
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
  }, [applyAuthResponse, cancelAuthOperation, clearLocalAuthState, defaultFacilityCode, setFacilityCode])
  const startPasskeySetup = useCallback((email, password, facility) => login(email, password, facility, { setup: true }), [login])

  const completeFactorLogin = useCallback((response, grant) => {
    if (!factorRef.current || factorRef.current.login_grant !== grant || Date.parse(factorRef.current.expires_at) <= Date.now()) throw new Error('This sign-in request changed or expired. Restart sign-in.')
    const checked = loginResult(response)
    if (checked.status !== 'authenticated') { factorRef.current = checked; setPendingFactor(checked); return null }
    factorRef.current = null; setPendingFactor(null)
    return applyAuthResponse(adaptV2AuthTokenResponse({ data: checked }))
  }, [applyAuthResponse])

  const cancelPendingLogin = useCallback(() => { cancelAuthOperation(); setError(null) }, [cancelAuthOperation])

  const reauthenticate = useCallback(async (email, password, facility, { signal } = {}) => {
    if (!isRustV2ApiMode()) return login(email, password, facility)
    if (!user || email !== user.email || facility !== user.facilityCode || authLifetime.current.blocked) throw new Error('The signed-in account changed. Restart confirmation.')
    authLifetime.current.request?.abort()
    const controller = new AbortController(); authLifetime.current.request = controller
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort()
    const generation = ++authLifetime.current.generation; const transport = getV2ClientScopeKey()
    const current = () => { if (controller.signal.aborted || generation !== authLifetime.current.generation || transport !== getV2ClientScopeKey()) throw new DOMException('Aborted', 'AbortError') }
    try {
      const [api, { dispatchCurrentSessionProof, sameProofSession, ordinarySessionProof, sameReadableNetwork, stageProofNetwork }] = await Promise.all([
        import('@/features/auth/api'), import('@/features/auth/proofUpgrade'),
      ])
      current()
      const { result, ordinary, dispatchStartedAt } = await dispatchCurrentSessionProof(user, password, api, { signal: controller.signal, current }); current()
      let continuity
      try {
        sameSessionIdentity(user, result)
        continuity = ordinary ? ordinarySessionProof(user, result, accessTokenRef.current, result.access_token, dispatchStartedAt) : sameProofSession(user, result, accessTokenRef.current, result.access_token, Boolean(password))
      } catch (error) { clearWorkflowContinuity(); authLifetime.current.blocked = true; await clearLocalAuthState('identity-confirmation-scope-changed'); throw error }
      const adapted = adaptV2AuthTokenResponse({ data: result }); const nextUser = providerUser(adapted, defaultFacilityCode)
      const authority = authorizationIdentity(user)
      const previous = currentConfirmedNetworkDecision(transport, authority)
      let networkFailure = null
      if (previous && continuity) {
        try {
          const staged = await stageProofNetwork(result.access_token, user.facilityCode, { signal: controller.signal }); current()
          const latest = currentConfirmedNetworkDecision(transport, authority)
          const nextTransport = getV2ClientScopeForToken(result.access_token, user.facilityCode)
          if (sameReadableNetwork(latest, staged)) {
            const target = requestAuthorizationScope(nextUser, nextTransport)
            installWorkflowContinuity({ source: requestAuthorizationScope(user, transport), target, sourceIdentity: hashQueryValue(authority), until: Math.min(Date.now() + result.expires_in_seconds * 1000, Date.parse(result.session_absolute_expires_at)), stagedDecision: staged })
            queryClient.setQueryData(networkKeys.current(target), staged)
          } else clearWorkflowContinuity()
        } catch (error) { current(); clearWorkflowContinuity(); networkFailure = error }
      } else clearWorkflowContinuity()
      const authenticated = applyAuthResponse(adapted, { sameSession: true })
      if (networkFailure) throw new Error('Identity was verified, but current network access could not be confirmed. Refresh connection status before continuing.')
      return authenticated
    } finally { signal?.removeEventListener('abort', abort); if (authLifetime.current.request === controller) authLifetime.current.request = null }
  }, [applyAuthResponse, clearLocalAuthState, defaultFacilityCode, login, user])

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
      startPasskeySetup,
      reauthenticate,
      pendingFactor,
      completeFactorLogin,
      cancelPendingLogin,
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
      startPasskeySetup,
      reauthenticate,
      pendingFactor,
      completeFactorLogin,
      cancelPendingLogin,
      logout,
      resetPassword,
    ]
  )
}
