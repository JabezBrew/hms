// Deferred saved-record bookkeeping. Loaded only while a recovery barrier exists.
export async function recordRecoveryRead(request, response, context, state) {
  const { admissionScope, load, scopeFor, digest, references, family, active, persist } = state;
  const { scope: currentScope, context: currentContext } = state.current();
  if (context.isCurrentScope?.() === false) return;
  if (context.denied) { if (load().entries.length) { const route = await admissionScope(request); if (context.isCurrentScope?.() !== false) route?.denyRead?.(); } return; }
  if (!context.principal?.id || !response || typeof response !== 'object' || !('data' in response)) return;
  if (!context.readEvidence?.length || !load().entries.length) return;
  // Lean eligibility/header reads cannot establish saved-record review. No
  // deferred bookkeeping is needed when there is no unresolved command.
  const evidencePath = String(request.resolvedPath).split('?')[0];
  if (evidencePath === '/api/v2/nursing/fluid-observations/context' || (/^\/api\/v2\/patients\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/clinical\/note-template-previews$/i.test(evidencePath))) return;
  const admission = await admissionScope(request);
  if (context.isCurrentScope?.() === false) return;
  if (admission?.captureRead) await admission.captureRead(response, { scope: currentScope, authority: currentContext?.authority, transport: currentContext?.transport, evidence: context.readEvidence.map(value => ({ ...value })), isCurrent: context.isCurrentScope });
  if (admission?.excludeRead || context.isCurrentScope?.() === false) return;
  const [scope, familyHash, related] = await Promise.all([scopeFor(context.principal), digest(`family:${admission?.family || family(request.resolvedPath)}`), references(request.pathParams, request.query, request.body, response.data)]); let changed = false;
  const readProofs = new Map(context.readEvidence.map((proof) => [proof.id, proof.uncertainty_id])); const relatedIds = new Set(related);
  if (admission?.extraReference) relatedIds.add(await digest(`reference:${admission.extraReference.toLowerCase()}`));
  if (context.isCurrentScope?.() === false) return;
  const pathParts = String(request.resolvedPath).split('?')[0].split('/').filter(Boolean); if (pathParts[0] !== 'api') pathParts.unshift('api', 'v2');
  const collectionResponse = Array.isArray(response.data) && (pathParts.length === 4 || (pathParts.length === 5 && pathParts[4] === 'search'));
  for (const entry of load().entries) {
    if ((!admission?.receiptRequestId || (entry.uuid === admission.receiptRequestId && admission.receiptMatches(response, context.principal))) && entry.scope === scope && entry.family === familyHash && readProofs.get(entry.id) === entry.uncertainty_id && !active.has(entry.id)
      && (entry.primary_reference ? relatedIds.has(entry.primary_reference) : (collectionResponse || !entry.references.length || entry.references.some((hash) => relatedIds.has(hash))))) { entry.reviewed_at = Date.now(); changed = true; }
  }
  if (changed) persist();
}
