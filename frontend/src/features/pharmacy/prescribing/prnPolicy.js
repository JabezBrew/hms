export const PRN_INTERVAL_HOURS = Object.freeze([4, 6, 8, 12, 24]);

export function emptyPrnPolicyForm() {
  return { prn_minimum_interval_hours: '', prn_maximum_doses_per_24_hours: '', prn_indication: '', prn_stock_units_per_dose: '' };
}

export function prnPolicyPayload(form) {
  return {
    minimum_interval_hours: Number(form.prn_minimum_interval_hours),
    maximum_doses_per_24_hours: Number(form.prn_maximum_doses_per_24_hours),
    indication: String(form.prn_indication ?? '').trim(),
    stock_units_per_dose: Number(form.prn_stock_units_per_dose),
    expected_stock_unit: String(form.inventory_item_unit ?? '').trim(),
  };
}

export function validatePrnPolicyForm(form) {
  const errors = {};
  const policy = prnPolicyPayload(form);
  if (!form.inventory_item_id || !form.inventory_item_unit?.trim()) errors.inventory_item_id = 'Choose a facility medication with a stock unit before prescribing an as-needed dose.';
  if (form.inventory_item_controlled) errors.inventory_item_id = 'As-needed orders for controlled stock are not available yet.';
  if (!PRN_INTERVAL_HOURS.includes(policy.minimum_interval_hours)) errors.prn_minimum_interval_hours = 'Choose the minimum time between doses.';
  if (!Number.isSafeInteger(policy.maximum_doses_per_24_hours) || policy.maximum_doses_per_24_hours < 1
    || policy.maximum_doses_per_24_hours > Math.floor(24 / policy.minimum_interval_hours)) errors.prn_maximum_doses_per_24_hours = 'Enter a whole daily limit consistent with the minimum interval.';
  if (!policy.indication || [...policy.indication].length > 500) errors.prn_indication = 'Enter the ordered indication using 500 characters or fewer.';
  if (!Number.isSafeInteger(policy.stock_units_per_dose) || policy.stock_units_per_dose < 1) errors.prn_stock_units_per_dose = 'Enter the whole number of stock units used for one dose.';
  return errors;
}

export function normalizePrnPolicy(policy) {
  if (policy === undefined || policy === null) return undefined;
  const normalized = {
    minimum_interval_hours: Number(policy.minimum_interval_hours),
    maximum_doses_per_24_hours: Number(policy.maximum_doses_per_24_hours),
    indication: typeof policy.indication === 'string' ? policy.indication.trim() : '',
    stock_units_per_dose: Number(policy.stock_units_per_dose),
    expected_stock_unit: typeof policy.expected_stock_unit === 'string' ? policy.expected_stock_unit.trim() : '',
  };
  if (!PRN_INTERVAL_HOURS.includes(normalized.minimum_interval_hours)
    || !Number.isSafeInteger(normalized.maximum_doses_per_24_hours) || normalized.maximum_doses_per_24_hours < 1
    || normalized.maximum_doses_per_24_hours > Math.floor(24 / normalized.minimum_interval_hours)
    || !normalized.indication || [...normalized.indication].length > 500 || !normalized.expected_stock_unit
    || !Number.isSafeInteger(normalized.stock_units_per_dose) || normalized.stock_units_per_dose < 1) {
    throw new Error('Complete the as-needed dose limits and stock units before saving.');
  }
  return normalized;
}
