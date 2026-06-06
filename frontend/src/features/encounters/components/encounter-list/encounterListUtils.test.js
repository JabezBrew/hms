import { describe, expect, it } from 'vitest';

import {
  ENCOUNTER_TABS,
  ENCOUNTER_TYPE_OPTIONS,
  RUST_V2_ENCOUNTER_TABS,
  RUST_V2_ENCOUNTER_TYPE_OPTIONS,
} from './encounterListConstants';
import {
  filterEncounterTabsForFeatures,
  filterEncounterTypeOptionsForFeatures,
} from './encounterListUtils';

const values = (items) => items.map((item) => Array.isArray(item) ? item[0] : item.value);

describe('encounter list feature scoping', () => {
  it('removes emergency and triage tabs when emergency encounters are disabled', () => {
    expect(values(filterEncounterTabsForFeatures(RUST_V2_ENCOUNTER_TABS, {
      emergency: false,
      outpatient: true,
    }))).toEqual(['outpatient']);
  });

  it('keeps all tab only when every tab type behind it is enabled', () => {
    expect(values(filterEncounterTabsForFeatures(RUST_V2_ENCOUNTER_TABS, {
      emergency: true,
      outpatient: true,
    }))).toEqual(['all', 'outpatient', 'emergency', 'triage']);

    expect(values(filterEncounterTabsForFeatures(ENCOUNTER_TABS, {
      emergency: true,
      inpatient: false,
      outpatient: true,
    }))).toEqual(['outpatient', 'emergency']);
  });

  it('filters encounter type options by enabled modules', () => {
    expect(values(filterEncounterTypeOptionsForFeatures(RUST_V2_ENCOUNTER_TYPE_OPTIONS, {
      emergency: false,
      outpatient: true,
    }))).toEqual(['all', 'outpatient']);

    expect(values(filterEncounterTypeOptionsForFeatures(ENCOUNTER_TYPE_OPTIONS, {
      emergency: true,
      inpatient: false,
      outpatient: true,
    }))).toEqual(['all', 'outpatient', 'emergency']);
  });
});
