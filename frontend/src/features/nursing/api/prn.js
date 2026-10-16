import { v2Api } from '@/lib/api/v2/client';

export async function getPrnOrdersPage(admissionId, cursor, { signal } = {}) {
  if (!admissionId) throw new Error('An active admission is required.');
  const response = await v2Api.getPrnOrders({ query: { admission_case_id: admissionId, limit: 25, ...(cursor ? { cursor } : {}) }, signal });
  if (!Array.isArray(response?.data)) throw new Error('As-needed orders could not be confirmed. Reload the panel.');
  const next = response.page?.has_next ? response.page.next_cursor : null;
  if (response.page?.has_next && !next) throw new Error('The next page could not be confirmed. Reload the as-needed orders.');
  if (next && next === cursor) throw new Error('The next page could not be confirmed. Reload the as-needed orders.');
  return { items: response.data, nextCursor: next };
}

export async function requestPrnDose(payload, { signal } = {}) {
  const indication = String(payload.indication || '').trim();
  if (!payload.prescription_id || !payload.admission_case_id || !payload.client_request_id || !indication || [...indication].length > 500) {
    throw new Error('Select the source order and record why this dose is needed (at most 500 characters).');
  }
  try {
    const response = await v2Api.postPrnDoseRequest({ prescription_id: payload.prescription_id, admission_case_id: payload.admission_case_id, client_request_id: payload.client_request_id, indication }, { signal });
    const result = response?.data;
    if (!result?.medication_administration_id || !result?.pharmacy_fulfillment_id || result.prescription_id !== payload.prescription_id || result.admission_case_id !== payload.admission_case_id || result.client_request_id !== payload.client_request_id) {
      throw new Error('Unconfirmed PRN response');
    }
    return result;
  } catch (error) {
    if (error?.status >= 400 && error.status < 500 && error?.data?.error?.code !== 'prn_request_unconfirmed') throw error;
    const uncertain = new Error('The dose request may have been saved. Review the refreshed medication record before making another request.');
    uncertain.name = 'PrnRequestUnconfirmedError';
    throw uncertain;
  }
}
