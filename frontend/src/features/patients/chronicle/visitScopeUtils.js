export const CHRONICLE_VISIT_PARAM = 'visit';
export const CHRONICLE_ALL_VISITS = 'all';

const TRANSIENT_CHRONICLE_PARAMS = Object.freeze([
  'action',
  'referral_id',
  'admission',
  'wardRound',
  'consultation',
]);

function normalizeVisitValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function hasEncounter(encounters, encounterId) {
  if (!encounterId || !Array.isArray(encounters)) {
    return false;
  }

  return encounters.some((encounter) => String(encounter?.id) === encounterId);
}

export function resolveChronicleVisitScope({
  requestedVisit,
  activeEncounterId,
  encounters,
  areEncountersLoading = false,
} = {}) {
  const normalizedRequested = normalizeVisitValue(requestedVisit);
  const normalizedActiveEncounterId = normalizeVisitValue(activeEncounterId);

  if (normalizedRequested === CHRONICLE_ALL_VISITS) {
    return CHRONICLE_ALL_VISITS;
  }

  if (normalizedRequested) {
    if (areEncountersLoading) {
      return normalizedRequested;
    }

    if (hasEncounter(encounters, normalizedRequested)) {
      return normalizedRequested;
    }
  }

  if (normalizedActiveEncounterId) {
    return normalizedActiveEncounterId;
  }

  if (areEncountersLoading) {
    return null;
  }

  const latestEncounterId = normalizeVisitValue(encounters?.[0]?.id);
  return latestEncounterId || CHRONICLE_ALL_VISITS;
}

export function buildChronicleSearch(search, { updates = {}, remove = [] } = {}) {
  const params = new URLSearchParams(search);

  remove.forEach((key) => {
    params.delete(key);
  });

  Object.entries(updates).forEach(([key, value]) => {
    const normalizedValue = normalizeVisitValue(value);

    if (!normalizedValue) {
      params.delete(key);
      return;
    }

    params.set(key, normalizedValue);
  });

  const query = params.toString();
  return query ? `?${query}` : '';
}

export function stripTransientChronicleParams(search) {
  return buildChronicleSearch(search, {
    remove: TRANSIENT_CHRONICLE_PARAMS,
  });
}
