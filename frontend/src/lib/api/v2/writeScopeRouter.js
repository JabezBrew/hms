// Command-family selection is deferred until an actual write or recovery read.
// Classifiers keep their own exact route predicates and recovery semantics.
export async function classifyWriteScope(request) {
  const path = String(request.resolvedPath).split('?')[0];
  if (/^\/api\/v2\/patients\/[^/]+\/clinical\/note-requests(?:\/|$)/.test(path)) return (await import('./clinicalNoteWriteScopes')).classifyClinicalNoteReceipt(path);
  if (/^\/api\/v2\/admin\/org-units(?:\/|$)/.test(path)) return (await import('./organizationWriteScopes')).classifyOrganizationWriteScope(path);
  if (/^\/api\/v2\/inventory\/storage-locations(?:\/|$)/.test(path)) return (await import('./storageLocationWriteScopes')).classifyStorageLocationWriteScope(path);
  if (path.includes('/referrals/')) return (await import('./referralWriteScopes')).classifyReferralWriteScope(path);
  if (!path.includes('/chronicle/admissions/') && !path.endsWith('/chronicle/admission-advisory-cases')) return null;
  return (await import('./admissionWriteScopes')).classifyAdmissionWriteScope(path, request.pathParams);
}

export async function organizationRecoveryCandidate(store, origin) {
  return (await import('./organizationWriteScopes')).organizationRecoveryCandidate(store, origin);
}

export async function storageLocationRecoveryCandidate(store, origin) {
  return (await import('./storageLocationWriteScopes')).storageLocationRecoveryCandidate(store, origin);
}
