import { expect, it } from 'vitest';
import { normalizeScheduledStockPolicy, physicalStockBasis, scheduledDoseReviewReason } from '../scheduledStockPolicy';
import { coursePayload, emptyCourseDraft, reuseCourseDraft } from '../courseModel';
import { requestId, source } from './fixtures';
const policy = { stock_unit: 'tablet', stock_units_per_dose: 2 };
it.each(['', '0', '-1', '0.5', '9007199254740992', true, {}, null])('does not infer or default unsafe scheduled stock units %j', (stock_units_per_dose) => {
  expect(() => normalizeScheduledStockPolicy({ expected_stock_unit: 'tablet', stock_units_per_dose })).toThrow();
});
it('keeps clinical dose text separate from explicitly reviewed scheduled units and resets source reuse', () => {
  const draft = { ...emptyCourseDraft(), medication_name: 'Synthetic', dose: '500 mg', route: 'oral', frequency: 'daily', start_date: '2026-10-17', change_reason: 'Synthetic review', inventory_item_id: requestId, inventory_item_unit: 'tablet' };
  expect(() => coursePayload(draft, source, 'replacement', requestId)).toThrow(/whole number/);
  expect(coursePayload({ ...draft, scheduled_stock_units_per_dose: '2' }, source, 'replacement', requestId)).toMatchObject({ dose: '500 mg', scheduled_stock_policy: { expected_stock_unit: 'tablet', stock_units_per_dose: 2 } });
  expect(reuseCourseDraft({ ...source, scheduled_stock_policy: policy })).toMatchObject({ inventory_item_id: null, scheduled_stock_units_per_dose: '' });
  expect(() => coursePayload({ ...draft, scheduled_stock_units_per_dose: '2', inventory_item_controlled: true }, source, 'replacement', requestId)).toThrow(/Controlled/);
});
it('requires captured scheduled per-dose supply evidence while preserving prior configured PRN and unlinked manual outcomes', () => {
  const record = { prescription_id: requestId, frequency: 'daily', is_dispensed: true };
  expect(scheduledDoseReviewReason(record)).toMatch(/unconfigured/);
  expect(scheduledDoseReviewReason({ ...record, scheduled_stock_policy: policy })).toMatch(/supplied stock evidence/);
  expect(scheduledDoseReviewReason({ ...record, scheduled_stock_policy: policy, dispensed_stock_quantity: 1, dispensed_stock_unit: 'tablet' })).toMatch(/supplied stock evidence/);
  expect(scheduledDoseReviewReason({ ...record, scheduled_stock_policy: policy, dispensed_stock_quantity: 2, dispensed_stock_unit: 'tablet' })).toBeNull();
  expect(scheduledDoseReviewReason({ ...record, frequency: ' PRN ', prn_policy: policy })).toBeNull();
  expect(scheduledDoseReviewReason({ ...record, prescription_id: null })).toBeNull();
  expect(physicalStockBasis({ frequency: ' PRN ', prn_policy: policy })).toEqual(policy);
});
