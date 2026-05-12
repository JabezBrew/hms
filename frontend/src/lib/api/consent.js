import { apiClient, handleApiError } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api } from './v2/client';

const RUST_V2_CROSS_FACILITY_REFERRAL_UNSUPPORTED_MESSAGE =
  'Cross-facility referral requests are not supported by Rust V2 yet.';
const RUST_V2_CONSENT_TOKEN_DEFERRED_MESSAGE =
  'Consent access tokens are intentionally deferred in Rust V2 pending product decisions on cross-facility token issuance, expiry, retrieval, and audit rules.';

const RUST_V2_CONSENT_SCOPES = new Set([
  'internal_care_team',
  'referral_coordination',
  'billing_disclosure',
]);

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function normalizeConsentScope(scope) {
  const normalized = String(scope || '').trim().toLowerCase();
  if (RUST_V2_CONSENT_SCOPES.has(normalized)) {
    return normalized;
  }
  if (['full_record', 'record_export', 'cross_facility', 'referral'].includes(normalized)) {
    return 'referral_coordination';
  }
  return 'referral_coordination';
}

function normalizeConsentPurpose(payload = {}) {
  const purpose = String(
    payload.purpose
      || payload.reason
      || payload.consent_reason
      || payload.summary
      || '',
  ).trim();
  if (purpose) {
    return purpose;
  }
  const targetFacilityCode = String(payload.target_facility_code || '').trim().toUpperCase();
  if (targetFacilityCode) {
    return `Cross-facility access for ${targetFacilityCode}`;
  }
  return 'Patient consent grant';
}

function v2ConsentGrantPayload(payload = {}) {
  const patientId = payload.patient_id || payload.patient || payload.patient_identity_id;
  if (!patientId) {
    throw new Error('Patient id is required to create a Rust V2 consent grant');
  }

  const grant = {
    patient_id: patientId,
    scope: normalizeConsentScope(payload.scope),
    purpose: normalizeConsentPurpose(payload),
  };

  if (payload.expires_at) {
    grant.expires_at = payload.expires_at;
  }

  return grant;
}

function adaptV2ConsentGrant(grant, source = {}) {
  if (!grant) {
    return grant;
  }
  return {
    ...grant,
    patient: grant.patient_id,
    patient_identity_id: source.patient_identity_id || source.patient_id || grant.patient_id,
    target_facility_code: source.target_facility_code || grant.target_facility_code || null,
    reason: grant.purpose,
    consent_reason: grant.purpose,
  };
}

export const consentApi = {
  createReferral: async (payload, options = {}) => {
    if (isRustV2ApiMode()) {
      throw new Error(RUST_V2_CROSS_FACILITY_REFERRAL_UNSUPPORTED_MESSAGE);
    }
    try {
      return await apiClient.post('/consent/referrals/', payload, options);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create referral'));
    }
  },

  createConsentGrant: async (payload, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postConsents(
          v2ConsentGrantPayload(payload),
          { signal: options.signal },
        );
        return adaptV2ConsentGrant(response?.data, payload);
      }
      return await apiClient.post('/consent/grants/', payload);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to grant consent'));
      }
      throw new Error(handleApiError(error, 'Failed to grant consent'));
    }
  },

  issueAccessToken: async (consentId, payload, options = {}) => {
    if (isRustV2ApiMode()) {
      throw new Error(RUST_V2_CONSENT_TOKEN_DEFERRED_MESSAGE);
    }
    try {
      return await apiClient.post(`/consent/grants/${consentId}/issue_token/`, payload, options);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to issue access token'));
    }
  },
};
