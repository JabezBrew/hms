// Command-family selection is deferred until an actual write or recovery read.
// Classifiers keep their own exact route predicates and recovery semantics.
export async function classifyWriteScope(request) {
  const path = String(request.resolvedPath).split('?')[0];
  if (/^\/api\/v2\/patients\/[^/]+\/clinical\/note-requests(?:\/|$)/.test(path)) return (await import('./clinicalNoteWriteScopes')).classifyClinicalNoteReceipt(path);
  if (/^\/api\/v2\/admin\/org-units(?:\/|$)/.test(path)) return (await import('./organizationWriteScopes')).classifyOrganizationWriteScope(path);
  if (/^\/api\/v2\/laboratory\/(?:test-administration|panel-administration|test-catalog|panels|catalog-commands)(?:\/|$)/.test(path)) return (await import('./laboratoryCatalogWriteScopes')).classifyLaboratoryCatalogWriteScope(path);
  if (/^\/api\/v2\/inventory\/(?:suppliers|supplier-administration|supplier-commands)(?:\/|$)/.test(path)) return (await import('./inventorySupplierWriteScopes')).classifyInventorySupplierWriteScope(path);
  if (/^\/api\/v2\/inventory\/(?:categories|category-administration|category-commands)(?:\/|$)/.test(path)) return (await import('./inventoryCategoryWriteScopes')).classifyInventoryCategoryWriteScope(path);
  if (/^\/api\/v2\/inventory\/(?:items|catalog-edits|item-commands)(?:\/|$)/.test(path)) return (await import('./inventoryItemWriteScopes')).classifyInventoryItemWriteScope(path);
  if (/^\/api\/v2\/inventory\/storage-locations(?:\/|$)/.test(path)) return (await import('./storageLocationWriteScopes')).classifyStorageLocationWriteScope(path);
  if (/^\/api\/v2\/scheduling\/services(?:\/|$)/.test(path)) return (await import('./bookableServiceWriteScopes')).classifyBookableServiceWriteScope(path);
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

export async function bookableServiceRecoveryCandidate(store, origin) {
  return (await import('./bookableServiceWriteScopes')).bookableServiceRecoveryCandidate(store, origin);
}

export async function inventoryItemRecoveryCandidate(store, origin) {
  return (await import('./inventoryItemWriteScopes')).inventoryItemRecoveryCandidate(store, origin);
}

export async function inventoryCategoryRecoveryCandidate(store, origin) {
  return (await import('./inventoryCategoryWriteScopes')).inventoryCategoryRecoveryCandidate(store, origin);
}

export async function inventorySupplierRecoveryCandidate(store, origin) {
  return (await import('./inventorySupplierWriteScopes')).inventorySupplierRecoveryCandidate(store, origin);
}

export async function laboratoryCatalogRecoveryCandidate(store, origin) {
  return (await import('./laboratoryCatalogWriteScopes')).laboratoryCatalogRecoveryCandidate(store, origin);
}
