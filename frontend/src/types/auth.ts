import type { EntityId } from './common'

export interface AccessContext {
  is_offsite?: boolean
  offsite_mode?: string
  readonly_message?: string | null
  [key: string]: unknown
}

export interface AuthUser {
  email: string
  id: EntityId
  role: string
  firstName: string
  lastName: string
  staffId: EntityId | null
  practitionerId: EntityId | null
  facilityCode: string | null
  accessContext: AccessContext | null
  [key: string]: unknown
}

export interface MfaMetadata {
  enrollment_required?: boolean
  [key: string]: unknown
}

export interface LoginResponseUser {
  email: string
  id: EntityId
  user_type: string
  first_name: string
  last_name: string
  staff_id?: EntityId | null
  practitioner_id?: EntityId | null
  facility_code?: string | null
  [key: string]: unknown
}

export interface LoginResponse {
  access?: string
  user?: LoginResponseUser
  access_context?: AccessContext | null
  mfa_required?: boolean
  mfa_session?: string | null
  mfa?: MfaMetadata | null
  [key: string]: unknown
}

export interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  error: string | null
  login: (email: string, password: string, facility?: string | null) => Promise<AuthUser | { mfaRequired: true } | null>
  completeMfa: (response: LoginResponse) => AuthUser | null
  logout: (localOnly?: boolean) => Promise<void>
  resetPassword: (email: string) => Promise<boolean>
  facilityCode: string | null
  setFacilityCode: (code: string | null) => void
  getAccessToken: () => string | null
  refreshAccessToken: () => Promise<string | null>
  isSessionValid: () => boolean
  mfaSession: string | null
  mfaUser: LoginResponseUser | null
  mfaEnrollmentRequired: boolean
  mfaAvailableMethods: MfaMetadata | null
  isAuthenticated: boolean
}
