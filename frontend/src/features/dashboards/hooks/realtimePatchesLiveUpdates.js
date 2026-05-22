const FRESHNESS_EVENT_TYPES = new Set([
  'dashboard.projection_freshness',
  'ward_board.projection_freshness',
  'laboratory.order_status_summary_updated',
]);

function normalizeRealtimeDelta(event = {}) {
  if (event?.payload?.event_type) {
    return event.payload;
  }
  return event;
}

function normalizeDashboardToken(value) {
  return value ? String(value).trim().toLowerCase() : null;
}

function shouldPatchFreshness(delta, expectedDashboard) {
  if (!delta?.event_type || !FRESHNESS_EVENT_TYPES.has(delta.event_type)) {
    return false;
  }
  const eventDashboard = normalizeDashboardToken(delta.dashboard ?? delta.patch?.dashboard);
  const expected = normalizeDashboardToken(expectedDashboard);
  return !eventDashboard || !expected || eventDashboard === expected;
}

function patchFreshnessValue(current, delta) {
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    return current;
  }
  const occurredAt = delta.occurred_at ?? delta.generated_at ?? new Date().toISOString();
  return {
    ...current,
    generated_at: current.generated_at ?? occurredAt,
    projection_fresh_at: occurredAt,
    realtime_freshness: {
      event_type: delta.event_type,
      entity_type: delta.entity_type,
      version: delta.version ?? null,
      occurred_at: occurredAt,
    },
  };
}

export function patchDashboardProjectionFreshness(
  queryClient,
  queryKey,
  event,
  expectedDashboard = null,
) {
  const delta = normalizeRealtimeDelta(event);
  if (!shouldPatchFreshness(delta, expectedDashboard)) {
    return false;
  }

  let patched = false;
  queryClient.setQueriesData({ queryKey }, (current) => {
    const next = patchFreshnessValue(current, delta);
    if (next !== current) {
      patched = true;
    }
    return next;
  });
  return patched;
}
