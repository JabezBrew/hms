/* oxlint-disable react-doctor/prefer-useReducer -- Auth state has independent concerns: token memory, MFA challenge state, facility scope, and session restore. A reducer would obscure existing tested transitions without adding a shared invariant. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getAuthValue, removeAuthValue, setAuthValue } from '@/lib/auth-storage'

import { authApi, adaptV2AuthTokenResponse } from "../api/auth"
import { loginResult, sameSessionIdentity } from '@/features/auth/model'
import { getV2ClientScopeKey, getV2ClientScopeForToken, hasV2RefreshSessionHint } from '../api/v2/session'
import { currentConfirmedNetworkDecision } from '../api/v2/networkAccessGuard'
import { authorizationIdentity, requestAuthorizationScope } from '@/shared/lib/authorizationScope'
import { clearWorkflowContinuity, getWorkflowContinuity, installWorkflowContinuity } from '@/shared/lib/workflowContinuity'
import { hashQueryValue } from '@/shared/lib/privateQueryKey'
import { providerUser } from '@/features/auth/providerUser'
import { tokenClaims } from '@/features/auth/clock'
import { networkKeys } from '@/features/settings/network/keys'
import { serverClock, clockNow, setActiveTokenClock } from '@/shared/lib/serverClock'
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
  const facilityRef = useRef(defaultFacilityCode)
  const providerMounted = useRef(true)
  const accessTokenRef = useRef(null)
  const userRef = useRef(null)
  const applied = useRef(null)
  const applyRef = useRef(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [workspaceInstanceKey, setWorkspaceInstanceKey] = useState(null)
  const workspaceKeyRef = useRef(null)
  const logoutPromiseRef = useRef(null)
  const justLoggedInRef = useRef(false)
  const [pendingFactor, setPendingFactor] = useState(null)
  const factorRef = useRef(null)
  const authorityEpoch = useRef(0)
  const authLifetime = useRef({ generation: 0, request: null, blocked: false })
  const cancelAuthOperation = useCallback(() => {
    authorityEpoch.current += 1
    clearWorkflowContinuity()
    authLifetime.current.generation += 1
    authLifetime.current.request?.abort()
    authLifetime.current.request = null
    factorRef.current = null
    setPendingFactor(null)
  }, [])
  useLayoutEffect(() => { providerMounted.current = true; return () => { providerMounted.current = false; authLifetime.current.generation += 1; authLifetime.current.request?.abort() } }, [])

  const getSessionBudget = useCallback(() => {
    if (authLifetime.current.blocked || !applied.current) return { remaining: 0, localRemaining: 0, checking: true }
    const localRemaining = SESSION_IDLE_TIMEOUT_MS - (clockNow() - applied.current.activity)
    return { remaining: applied.current.clock.sessionRemaining(), idleRemaining: applied.current.clock.idleRemaining(), absoluteRemaining: applied.current.clock.absoluteRemaining(), localRemaining, checking: Boolean(applied.current.checking) }
  }, [])
  const isReady = useCallback(() => {
    if (!isRustV2ApiMode()) return !authLifetime.current.blocked && isStoredSessionValid()
    const value = getSessionBudget()
    return value.remaining > 0 && value.localRemaining > 0 && !value.checking
  }, [getSessionBudget])
  const getRawAccessToken = useCallback(() => providerMounted.current && !authLifetime.current.blocked ? accessTokenRef.current : null, [])
  const getAccessToken = useCallback(() => isReady() ? accessTokenRef.current : null, [isReady])
  const setAccessToken = useCallback((token, result) => {
    if (token && authLifetime.current.blocked) return
    if (result && isRustV2ApiMode()) return applyRef.current?.(adaptV2AuthTokenResponse({ data: result }), { sameSession: true, refresh: true })
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
      workspaceKeyRef.current = null; setWorkspaceInstanceKey(null)
      if (isRustV2ApiMode()) { if (applied.current) applied.current.checking = true; setSessionReady(false) }
      void clearCockpitCache('facility-change')
    }
    facilityRef.current = normalized
    setFacilityCodeState(normalized)
    queryClient.clear()
    if (user) {
      const updatedUser = { ...user, facilityCode: normalized }
      userRef.current = updatedUser
      setAuthValue("user", JSON.stringify(updatedUser))
      setUser(updatedUser)
    } else if (mfaUser) {
      setMfaUser({ ...mfaUser, facilityCode: normalized })
    }
  }, [cancelAuthOperation, clearCockpitCache, facilityCode, user, mfaUser])

  const clearPasswordChangeRequirement = useCallback(() => {
    const currentUser = userRef.current
    if (!currentUser || !currentUser.passwordChangeRequired) return
    const updatedUser = { ...currentUser, passwordChangeRequired: false }
    userRef.current = updatedUser
    setAuthValue("user", JSON.stringify(updatedUser))
    setUser(updatedUser)
  }, [])

  const clearLocalAuthState = useCallback(async (reason = 'auth-clear') => {
    removeAuthValue("user")
    removeAuthValue("sessionStartTime")
    removeAuthValue("lastActivityAt")
    removeAuthValue("refreshTokenIssuedAt")
    removeAuthValue("sessionIdleExpiresAt")
    removeAuthValue("sessionAbsoluteExpiresAt")
    userRef.current = null
    applied.current = null
    workspaceKeyRef.current = null
    setWorkspaceInstanceKey(null)
    setSessionReady(false)
    setActiveTokenClock(null, null)
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
    return isReady()
  }, [isReady])

  const handleRefreshFailure = useCallback(async () => {
    await logout(false, 'session-expired')
    notifications.info("Your session has expired. Please log in again.")
  }, [logout])

  const refreshAccessToken = useCallback(async () => {
    if (isRustV2ApiMode()) {
      if (authLifetime.current.blocked) return null
      if (applied.current) applied.current.checking = true
      setSessionReady(false)
      try {
        const response = await performV2TokenRefresh({ notifyFailure: false, throwFailure: true })
        return response?.access_token || null
      } catch (failure) {
        if (failure?.status === 401 || failure?.code === 'auth_proof_invalid') await handleRefreshFailure()
        return null
      }
    }
    if (!isSessionValid()) { await handleRefreshFailure(); return null }
    const token = await performTokenRefresh()
    if (!token) { await handleRefreshFailure(); return null }
    setAuthValue('refreshTokenIssuedAt', Date.now().toString())
    return token
  }, [isSessionValid, handleRefreshFailure])

  useEffect(() => {
    const initializeAuth = async () => {
      const generation = authLifetime.current.generation
      const storedUser = getAuthValue("user")
      if (storedUser) {
        try {
          const userData = JSON.parse(storedUser)

          if (!isRustV2ApiMode() && !isSessionValid()) {
            void notifyBackendLogout()
            await clearLocalAuthState('session-expired')
            setLoading(false)
            return
          }

          if (authLifetime.current.blocked || authLifetime.current.generation !== generation) return
          // Persisted Rust metadata is a restore hint, never current authority.
          if (!isRustV2ApiMode()) { setUser(userData); userRef.current = userData }
          facilityRef.current = userData.facilityCode || defaultFacilityCode
          if (!isRustV2ApiMode()) setFacilityCodeState(facilityRef.current)
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

  useLayoutEffect(() => {
    setAuthTokenProvider(getAccessToken, setAccessToken, handleRefreshFailure)
    setFacilityCodeProvider(() => facilityCode)
    configureV2ApiClient({
      getAccessToken: isRustV2ApiMode() ? getRawAccessToken : getAccessToken,
      setAccessToken,
      canUseSession: isReady,
      onRefreshFailure: handleRefreshFailure,
      getFacilityCode: () => facilityRef.current,
      canRefreshSession: () => isRustV2ApiMode() ? !authLifetime.current.blocked : isSessionValid(),
    })
  }, [getAccessToken, getRawAccessToken, isReady, setAccessToken, handleRefreshFailure, facilityCode, isSessionValid])

  useEffect(() => {
    if (!user) {
      return undefined
    }

    let lastActivityWriteAt = 0
    const recordActivity = () => {
      const now = isRustV2ApiMode() ? clockNow() : Date.now()
      if (now - lastActivityWriteAt < ACTIVITY_THROTTLE_MS) {
        return
      }
      if (isRustV2ApiMode()) {
        if (!isReady() || !applied.current) return
        applied.current.activity = now
      } else if (!recordSessionActivity(now)) return
      lastActivityWriteAt = now
    }

    if (!isRustV2ApiMode()) recordActivity()
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
  }, [user, isReady])

  const applyAuthResponse = useCallback((response, { sameSession = false, refresh = false } = {}) => {
    if (!response?.access || !response?.user) {
      return null
    }

    const rust = isRustV2ApiMode()
    const observation = rust ? serverClock(response) : null
    if (rust) { observation?.assertResponse(); if (!observation || observation.token !== response.access || observation.sessionRemaining() <= 0) throw new Error('The current server session could not be confirmed.') }
    const previousToken = accessTokenRef.current
    const previousUser = userRef.current
    const previousActivity = applied.current?.activity
    authLifetime.current.blocked = false
    // Activate only the validated current response. No clock facts enter storage.
    if (rust) observation.activate(() => providerMounted.current && !authLifetime.current.blocked && accessTokenRef.current === response.access && applied.current?.clock === observation)
    accessTokenRef.current = response.access
    if (rust) { applied.current = { token: response.access, clock: observation, activity: sameSession && Number.isFinite(previousActivity) ? previousActivity : clockNow(), checking: false }; setActiveTokenClock(response.access, observation); setSessionReady(true) }

    const now = Date.now().toString()
    if (!sameSession) {
      setAuthValue("sessionStartTime", now)
      if (!rust) persistSessionTiming(response, Number.parseInt(now, 10), { recordActivity: true })
    } else if (!rust) {
      if (response.session_idle_expires_at) setAuthValue('sessionIdleExpiresAt', response.session_idle_expires_at)
      if (response.session_absolute_expires_at) setAuthValue('sessionAbsoluteExpiresAt', response.session_absolute_expires_at)
    }

    const userData = providerUser(response, defaultFacilityCode)
    if (rust) {
      const exactRefresh = refresh && observation.source.path === '/api/v2/auth/refresh' && observation.source.token === previousToken && previousUser
        && authorizationIdentity(previousUser) === authorizationIdentity(userData) && Boolean(previousUser.passwordChangeRequired) === Boolean(userData.passwordChangeRequired)
        && tokenClaims(previousToken).auth_time === tokenClaims(response.access).auth_time
      const targetScope = requestAuthorizationScope(userData, getV2ClientScopeForToken(response.access, userData.facilityCode))
      const sourceScope = previousUser && previousToken ? requestAuthorizationScope(previousUser, getV2ClientScopeForToken(previousToken, previousUser.facilityCode)) : null
      const continuity = getWorkflowContinuity()
      const verifiedHandoff = sameSession && !refresh && continuity?.until > clockNow() && continuity.source === sourceScope && continuity.target === targetScope
      const nextKey = (exactRefresh || verifiedHandoff) && workspaceKeyRef.current ? workspaceKeyRef.current : targetScope
      workspaceKeyRef.current = nextKey; setWorkspaceInstanceKey(nextKey)
      if (refresh) clearWorkflowContinuity()
    }
    userRef.current = userData
    facilityRef.current = userData.facilityCode || defaultFacilityCode

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
  }, [clearCockpitCache, defaultFacilityCode, facilityCode, user])
  useLayoutEffect(() => {
    applyRef.current = applyAuthResponse
    return () => {
      if (applyRef.current === applyAuthResponse) applyRef.current = null
    }
  }, [applyAuthResponse])

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
    if (!factorRef.current || factorRef.current.login_grant !== grant || !(serverClock(factorRef.current)?.remaining(factorRef.current.expires_at) > 0)) throw new Error('This sign-in request changed or expired. Restart sign-in.')
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
      const { result, ordinary } = await dispatchCurrentSessionProof(user, password, api, { signal: controller.signal, current }); current()
      let continuity; let commandConfirmed = true
      try {
        sameSessionIdentity(user, result)
        if (ordinary) { const proof = ordinarySessionProof(user, result, accessTokenRef.current, result.access_token); continuity = proof.continuity; commandConfirmed = proof.confirmed }
        else continuity = sameProofSession(user, result, accessTokenRef.current, result.access_token, Boolean(password))
      } catch (error) { clearWorkflowContinuity(); authLifetime.current.blocked = true; await clearLocalAuthState('identity-confirmation-scope-changed'); throw error }
      const adapted = adaptV2AuthTokenResponse({ data: result }); const nextUser = providerUser(adapted, defaultFacilityCode)
      const authority = authorizationIdentity(user)
      const previous = currentConfirmedNetworkDecision(transport, authority)
      let networkFailure = null; let continuityPlan = null
      if (previous && continuity) {
        try {
          const staged = await stageProofNetwork(result.access_token, user.facilityCode, { signal: controller.signal, current }); current()
          const latest = currentConfirmedNetworkDecision(transport, authority)
          const nextTransport = getV2ClientScopeForToken(result.access_token, user.facilityCode)
          if (sameReadableNetwork(latest, staged)) {
            const target = requestAuthorizationScope(nextUser, nextTransport)
            continuityPlan = { source: requestAuthorizationScope(user, transport), target, sourceIdentity: hashQueryValue(authority), remaining: serverClock(result).sessionRemaining(), stagedDecision: staged }
          } else clearWorkflowContinuity()
        } catch (error) { current(); clearWorkflowContinuity(); networkFailure = error }
      } else clearWorkflowContinuity()
      current()
      if (continuityPlan) {
        const stagedClock = serverClock(continuityPlan.stagedDecision); const nextTransport = getV2ClientScopeForToken(result.access_token, nextUser.facilityCode); const nextAuthority = authorizationIdentity(nextUser); const networkEpoch = authorityEpoch.current
        stagedClock.activate(() => providerMounted.current && authorityEpoch.current === networkEpoch && getV2ClientScopeKey() === nextTransport && authorizationIdentity(userRef.current) === nextAuthority, { network: true })
        installWorkflowContinuity(continuityPlan); queryClient.setQueryData(networkKeys.current(continuityPlan.target), continuityPlan.stagedDecision) }
      const authenticated = applyAuthResponse(adapted, { sameSession: true })
      if (!commandConfirmed) throw new Error('The session was updated, but this password confirmation was not confirmed. Review the current session and confirm again before continuing.')
      if (networkFailure) throw new Error('Identity was verified, but current network access could not be confirmed. Refresh connection status before continuing.')
      return authenticated
    } finally { signal?.removeEventListener('abort', abort); if (authLifetime.current.request === controller) authLifetime.current.request = null }
  }, [applyAuthResponse, clearLocalAuthState, defaultFacilityCode, login, user])

  useEffect(() => {
    if (!isRustV2ApiMode() || !user || !sessionReady) return undefined
    let timer
    const check = () => {
      const budget = getSessionBudget()
      if (budget.localRemaining <= 0) { void logout(false, 'local-inactivity'); return }
      if (budget.remaining <= 0) { void refreshAccessToken(); return }
      timer = window.setTimeout(check, Math.min(budget.remaining, budget.localRemaining, 2147483647))
    }
    check(); window.addEventListener('focus', check); document.addEventListener('visibilitychange', check)
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check) }
  }, [user, sessionReady, getSessionBudget, logout, refreshAccessToken])

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
      sessionReady: !isRustV2ApiMode() || sessionReady,
      workspaceInstanceKey,
      getSessionBudget,
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
      sessionReady,
      workspaceInstanceKey,
      getSessionBudget,
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
