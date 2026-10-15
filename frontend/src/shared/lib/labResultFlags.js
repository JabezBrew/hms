const SUPPORTED_FLAGS = new Set(['normal', 'low', 'high', 'abnormal', 'critical', 'critical_low', 'critical_high']);

export function getLabResultFlag(result = {}) {
  const flag = typeof result?.flag === 'string' ? result.flag.trim().toLowerCase() : '';
  if (result?.is_critical === true && !['critical_low', 'critical_high'].includes(flag)) {
    return 'critical';
  }
  return SUPPORTED_FLAGS.has(flag) ? flag : 'unknown';
}
