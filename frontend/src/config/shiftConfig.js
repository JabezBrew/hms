/**
 * Shift Configuration
 *
 * Facilities can customize shift definitions by modifying SHIFT_CONFIG.
 * Supports any number of shifts with custom times.
 *
 * Common patterns:
 * - 8-hour shifts: 8am-2pm, 2pm-8pm, 8pm-8am (default)
 * - 12-hour shifts: 7am-7pm, 7pm-7am
 * - Custom: any configuration your facility uses
 */

const SHIFT_CONFIG = {
  shifts: [
    {
      value: 'day',
      label: 'Day Shift (8am - 2pm)',
      startHour: 8,
      endHour: 14
    },
    {
      value: 'evening',
      label: 'Evening Shift (2pm - 8pm)',
      startHour: 14,
      endHour: 20
    },
    {
      value: 'night',
      label: 'Night Shift (8pm - 8am)',
      startHour: 20,
      endHour: 8  // Crosses midnight
    },
  ]
};

/**
 * Determine current shift type based on time
 * @param {Date} date - Date to check (defaults to now)
 * @param {Object} config - Shift configuration (defaults to SHIFT_CONFIG)
 * @returns {string} - The shift value (e.g., 'day', 'evening', 'night')
 */
export function getShiftTypeFromTime(date = new Date(), config = SHIFT_CONFIG) {
  const hour = date.getHours();

  for (const shift of config.shifts) {
    const { startHour, endHour, value } = shift;

    // Handle overnight shifts that cross midnight
    if (startHour > endHour) {
      // Shift crosses midnight (e.g., 20:00 - 08:00)
      if (hour >= startHour || hour < endHour) {
        return value;
      }
    } else {
      // Normal shift within same day (e.g., 08:00 - 14:00)
      if (hour >= startHour && hour < endHour) {
        return value;
      }
    }
  }

  // Default to first shift if no match found
  return config.shifts[0]?.value || 'day';
}

/**
 * Get shift label by value
 * @param {string} value - Shift value (e.g., 'day')
 * @param {Object} config - Shift configuration
 * @returns {string} - The shift label
 */
export function getShiftLabel(value, config = SHIFT_CONFIG) {
  const shift = config.shifts.find(s => s.value === value);
  return shift?.label || value;
}

/**
 * Get all shift options for select dropdowns
 * @param {Object} config - Shift configuration
 * @returns {Array} - Array of { value, label } objects
 */
export function getShiftOptions(config = SHIFT_CONFIG) {
  return config.shifts.map(({ value, label }) => ({ value, label }));
}
