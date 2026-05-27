import { describe, expect, it } from 'vitest';

import {
  getInitialExpandedEncounterIds,
  getInitialExpandedNoteIds,
  hasEntryDetailContent,
  isInlineExpandableNoteEntry,
  shouldDeferEncounterExpansionSeed,
} from '../chronicleNoteUtils';

describe('chronicleNoteUtils', () => {
  it('expands the active encounter when it is documented', () => {
    const expanded = getInitialExpandedEncounterIds({
      activeEncounterId: 22,
      encounters: [
        { encounter: { id: 11 } },
        { encounter: { id: 22 } },
      ],
      unlinkedEntries: [],
    });

    expect([...expanded]).toEqual(['22']);
  });

  it('falls back to the newest documented encounter when there is no active match', () => {
    const expanded = getInitialExpandedEncounterIds({
      activeEncounterId: 99,
      encounters: [
        { encounter: { id: 'enc-1' } },
        { encounter: { id: 'enc-2' } },
      ],
      unlinkedEntries: [{ id: 'legacy-note' }],
    });

    expect([...expanded]).toEqual(['enc-1']);
  });

  it('opens unlinked entries when they are the only chronicle content', () => {
    const expanded = getInitialExpandedEncounterIds({
      activeEncounterId: null,
      encounters: [],
      unlinkedEntries: [{ id: 'legacy-note' }],
    });

    expect([...expanded]).toEqual(['unlinked']);
  });

  it('defers default expansion while the active encounter group can still arrive', () => {
    expect(shouldDeferEncounterExpansionSeed({
      activeEncounterId: 'enc-active',
      encounters: [{ encounter: { id: 'enc-old' } }],
      hasNextPage: true,
    })).toBe(true);
  });

  it('allows fallback expansion once the active encounter group is present', () => {
    expect(shouldDeferEncounterExpansionSeed({
      activeEncounterId: 'enc-active',
      encounters: [{ encounter: { id: 'enc-active' } }],
      hasNextPage: true,
    })).toBe(false);
  });

  it('does not defer unlinked-only expansion when no active encounter is known', () => {
    expect(shouldDeferEncounterExpansionSeed({
      activeEncounterId: null,
      encounters: [],
      isTimelineLoading: true,
    })).toBe(false);
  });

  it('auto-expands the newest detailed note on the all filter', () => {
    const expanded = getInitialExpandedNoteIds({
      activeFilter: 'all',
      entries: [
        { id: 1, type: 'vitals', data: { heart_rate: 85 } },
        { id: 2, type: 'progress_note', data: { assessment: 'Stable overnight' } },
        { id: 3, type: 'progress_note', content: 'Brief note' },
      ],
    });

    expect([...expanded]).toEqual(['2']);
  });

  it('opens the two newest note entries on the notes filter', () => {
    const expanded = getInitialExpandedNoteIds({
      activeFilter: 'progress_note',
      entries: [
        { id: 'note-1', type: 'progress_note', data: { subjective: 'Pain improved' } },
        { id: 'note-2', type: 'consult_note', content: 'x'.repeat(200) },
        { id: 'note-3', type: 'vitals', data: { blood_pressure: '120/80' } },
        { id: 'note-4', type: 'progress_note', content: 'Short' },
      ],
    });

    expect([...expanded]).toEqual(['note-1', 'note-2']);
  });

  it('recognizes which entries can be opened inline', () => {
    expect(isInlineExpandableNoteEntry({
      id: 'note-1',
      type: 'progress_note',
      data: { plan: 'Continue observation' },
    })).toBe(true);

    expect(isInlineExpandableNoteEntry({
      id: 'entry-2',
      type: 'vitals',
      data: { heart_rate: 90 },
    })).toBe(false);
  });

  it('only treats long text or structured note data as detail content', () => {
    expect(hasEntryDetailContent({
      type: 'progress_note',
      content: 'x'.repeat(151),
    })).toBe(true);

    expect(hasEntryDetailContent({
      type: 'progress_note',
      data: { assessment: 'Doing well' },
    })).toBe(true);

    expect(hasEntryDetailContent({
      type: 'progress_note',
      content: 'Short note',
    })).toBe(false);
  });
});
