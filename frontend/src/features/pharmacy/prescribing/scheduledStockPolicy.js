export const emptyScheduledStockForm = () => ({ scheduled_stock_units_per_dose: '' });
export function normalizeScheduledStockPolicy(value) {
  if (value === undefined || value === null) return undefined;
  const unit = typeof value.expected_stock_unit === 'string' ? value.expected_stock_unit.trim() : '';
  const quantity = Number(value.stock_units_per_dose);
  if (!['number', 'string'].includes(typeof value.stock_units_per_dose) || !unit || [...unit].length > 100 || !Number.isSafeInteger(quantity) || quantity < 1) throw new Error('Review a positive whole number of catalog stock units for one scheduled dose.');
  return { expected_stock_unit: unit, stock_units_per_dose: quantity };
}
export function scheduledStockPolicyPayload(form) { return normalizeScheduledStockPolicy({ expected_stock_unit: form.inventory_item_unit, stock_units_per_dose: form.scheduled_stock_units_per_dose }); }
export function validateScheduledStockForm(form) {
  try { if (form.inventory_item_controlled) throw new Error('Controlled stock cannot be linked in this scheduled-medication workflow.'); scheduledStockPolicyPayload(form); return {}; }
  catch (error) { return { scheduled_stock_units_per_dose: error.message }; }
}
export function savedStockPolicy(value) {
  if (!value || typeof value.stock_unit !== 'string' || !value.stock_unit.trim() || [...value.stock_unit].length > 100 || !Number.isSafeInteger(value.stock_units_per_dose) || value.stock_units_per_dose < 1) return null;
  return value;
}
export function physicalStockBasis(value) { return savedStockPolicy(String(value?.frequency || '').trim().toLowerCase() === 'prn' ? value?.prn_policy : value?.scheduled_stock_policy); }
export function scheduledPolicyMatches(saved, requested) { const policy = savedStockPolicy(saved); return Boolean(policy && requested && policy.stock_unit === requested.expected_stock_unit && policy.stock_units_per_dose === requested.stock_units_per_dose); }

export function scheduledDoseReviewReason(record) {
  if (!record?.prescription_id || record.prn_request_id || String(record.frequency || '').trim().toLowerCase() === 'prn') return null;
  const policy = savedStockPolicy(record.scheduled_stock_policy);
  if (!policy) return 'The scheduled stock basis is unconfigured. Prescriber review and a new linked course are required before this dose can be given.';
  if (record.is_dispensed && (record.dispensed_stock_quantity !== policy.stock_units_per_dose || record.dispensed_stock_unit !== policy.stock_unit)) return 'The supplied stock evidence does not confirm the prescribed units for this dose. Review the record before administration.';
  return null;
}
