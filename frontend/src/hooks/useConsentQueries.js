import { useMutation } from '@tanstack/react-query';
import { consentApi } from '@/shared/api/consent';

export function useCreateCrossFacilityReferral() {
  // No cache invalidation: this hook returns the created referral to its caller and no consent/referral query cache is owned here.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: (payload) => consentApi.createReferral(payload),
  });
}

export function useCreateConsentGrant() {
  // No cache invalidation: grant creation returns the created grant and this module does not define a cached grant list.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: (payload) => consentApi.createConsentGrant(payload),
  });
}

export function useIssueConsentToken() {
  // No cache invalidation: issuing an access token returns an ephemeral token and must not be cached.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: ({ consentId, payload }) =>
      consentApi.issueAccessToken(consentId, payload),
  });
}
