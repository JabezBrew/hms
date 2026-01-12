import { useMutation } from '@tanstack/react-query';
import { consentApi } from '@/lib/api/consent';

export function useCreateCrossFacilityReferral() {
  return useMutation({
    mutationFn: (payload) => consentApi.createReferral(payload),
  });
}

export function useCreateConsentGrant() {
  return useMutation({
    mutationFn: (payload) => consentApi.createConsentGrant(payload),
  });
}

export function useIssueConsentToken() {
  return useMutation({
    mutationFn: ({ consentId, payload }) =>
      consentApi.issueAccessToken(consentId, payload),
  });
}
