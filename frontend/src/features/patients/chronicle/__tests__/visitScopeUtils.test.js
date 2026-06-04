import { describe, expect, it } from 'vitest';

import {
  buildChronicleSearch,
  CHRONICLE_ALL_VISITS,
  CHRONICLE_VISIT_PARAM,
  resolveChronicleVisitScope,
  stripTransientChronicleParams,
} from '../visitScopeUtils';

describe('visitScopeUtils', () => {
  it('keeps an explicit all-history scope', () => {
    const scope = resolveChronicleVisitScope({
      requestedVisit: CHRONICLE_ALL_VISITS,
      activeEncounterId: 'enc-active',
      encounters: [{ id: 'enc-active' }],
    });

    expect(scope).toBe(CHRONICLE_ALL_VISITS);
  });

  it('keeps an explicit encounter scope while encounter data is loading', () => {
    const scope = resolveChronicleVisitScope({
      requestedVisit: 'enc-requested',
      areEncountersLoading: true,
    });

    expect(scope).toBe('enc-requested');
  });

  it('falls back to the active encounter when the requested encounter is invalid', () => {
    const scope = resolveChronicleVisitScope({
      requestedVisit: 'enc-missing',
      activeEncounterId: 'enc-active',
      encounters: [{ id: 'enc-active' }, { id: 'enc-old' }],
      areEncountersLoading: false,
    });

    expect(scope).toBe('enc-active');
  });

  it('falls back to the latest encounter when there is no active encounter', () => {
    const scope = resolveChronicleVisitScope({
      encounters: [{ id: 'enc-latest' }, { id: 'enc-older' }],
      areEncountersLoading: false,
    });

    expect(scope).toBe('enc-latest');
  });

  it('falls back to all history when there are no encounters', () => {
    const scope = resolveChronicleVisitScope({
      encounters: [],
      areEncountersLoading: false,
    });

    expect(scope).toBe(CHRONICLE_ALL_VISITS);
  });

  it('removes transient chronicle params while preserving visit scope', () => {
    const nextSearch = stripTransientChronicleParams(
      '?action=add_note&referral_id=123&note_type=doctor_note&title=Discharge+summary&visit=enc-1&foo=bar'
    );

    expect(nextSearch).toBe('?visit=enc-1&foo=bar');
  });

  it('updates the visit scope without dropping unrelated params', () => {
    const nextSearch = buildChronicleSearch('?foo=bar', {
      updates: {
        [CHRONICLE_VISIT_PARAM]: 'enc-2',
      },
    });

    expect(nextSearch).toBe('?foo=bar&visit=enc-2');
  });

  it('removes the visit param when given an empty value', () => {
    const nextSearch = buildChronicleSearch('?foo=bar&visit=enc-2', {
      updates: {
        [CHRONICLE_VISIT_PARAM]: '',
      },
    });

    expect(nextSearch).toBe('?foo=bar');
  });
});
