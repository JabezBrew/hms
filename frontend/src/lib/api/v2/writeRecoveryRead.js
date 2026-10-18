// Deferred saved-record bookkeeping. Loaded only while a recovery barrier exists.
export async function recordRecoveryRead(request, response, context, state) {
  const { admissionScope, load, scopeFor, digest, references, family, active, persist } = state;
  const { scope: currentScope, context: currentContext } = state.current();
  if (context.isCurrentScope?.() === false) return;
  if (context.denied) { if (load().entries.length) { const route = await admissionScope(request); if (context.isCurrentScope?.() !== false) route?.denyRead?.(); } return; }
  if (!context.principal?.id || !response || typeof response !== 'object' || !('data' in response)) return;
  if (!context.readEvidence?.length || !load().entries.length) return;
  const isReadCurrent = state.readLease(context.readEvidence);
  const currentRead = () => context.isCurrentScope?.() !== false && isReadCurrent?.() === true;
  if (!currentRead()) return;
  // Lean eligibility/header reads cannot establish saved-record review. No
  // deferred bookkeeping is needed when there is no unresolved command.
  const evidencePath = String(request.resolvedPath).split('?')[0];
  if (evidencePath === '/api/v2/nursing/fluid-observations/context' || (/^\/api\/v2\/patients\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/clinical\/note-template-previews$/i.test(evidencePath))) return;
  const admission = await admissionScope(request);
  if (!currentRead()) return;
  if (admission?.captureRead) await admission.captureRead(response, { scope: currentScope, authority: currentContext?.authority, transport: currentContext?.transport, evidence: context.readEvidence.map(value => ({ ...value })), isCurrent: context.isCurrentScope, isReadCurrent });
  if (admission?.excludeRead || !currentRead()) return;
  const readFamily = admission?.readFamily ? admission.readFamily(response) : admission?.family || family(request.resolvedPath);
  const [scope, familyHash, related] = await Promise.all([scopeFor(context.principal), digest(`family:${readFamily}`), references(request.pathParams, request.query, request.body, response.data)]);
  const reviewed = [];
  const readProofs = new Map(context.readEvidence.map((proof) => [proof.id, proof.uncertainty_id])); const relatedIds = new Set(related);
  if (admission?.extraReference) relatedIds.add(await digest(`reference:${admission.extraReference.toLowerCase()}`));
  if (!currentRead()) return;
  const pathParts = String(request.resolvedPath).split('?')[0].split('/').filter(Boolean); if (pathParts[0] !== 'api') pathParts.unshift('api', 'v2');
  const collectionResponse = Array.isArray(response.data) && (pathParts.length === 4 || (pathParts.length === 5 && pathParts[4] === 'search'));
  const receiptMatches = !admission?.receiptRequestId || await admission.receiptMatches(response, context.principal);
  if (!currentRead() || !receiptMatches) return;
  const receiptFingerprint = admission?.receiptFingerprint ? await admission.receiptFingerprint(response, digest) : null;
  if (!currentRead()) return;
  const candidateCurrent = entry => load().entries.includes(entry) && entry.scope === scope && entry.family === familyHash && (!receiptFingerprint || entry.fingerprint === receiptFingerprint) && readProofs.get(entry.id) === entry.uncertainty_id && !active.has(entry.id);
  for (const entry of load().entries) {
    if ((!admission?.receiptRequestId || entry.uuid === admission.receiptRequestId) && entry.scope === scope && entry.family === familyHash && (!receiptFingerprint || entry.fingerprint === receiptFingerprint) && readProofs.get(entry.id) === entry.uncertainty_id && !active.has(entry.id)
      && (entry.primary_reference ? relatedIds.has(entry.primary_reference) : (collectionResponse || !entry.references.length || entry.references.some((hash) => relatedIds.has(hash))))) { reviewed.push(entry); }
  }
  // Receipt matching and hashing may finish after a newer denial or an
  // authority A-to-B-to-A transition. Only a still-current dispatch may review.
  if (!currentRead() || !reviewed.length) return;
  for (const entry of reviewed) if (candidateCurrent(entry)) {
    entry.reviewed_at = Date.now();
    state.review(entry, () => currentRead() && candidateCurrent(entry) && entry.reviewed_at !== null);
  }
  persist();
}
