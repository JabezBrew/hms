export const patientId = '11111111-1111-4111-8111-111111111111';
export const referralId = '22222222-2222-4222-8222-222222222222';
export const actorId = '33333333-3333-4333-8333-333333333333';
export const revisionId = '44444444-4444-4444-8444-444444444444';
export const requestId = '55555555-5555-4555-8555-555555555555';
export const laterId = '66666666-6666-4666-8666-666666666666';
export const at = '2026-10-17T09:00:00Z';
export const scope = { patientId, referralId };
export const context = { patient_id: patientId, referral_id: referralId, to_service: 'Synthetic specialist service', priority: 'routine', created_at: at, status: 'accepted', version: 0, context_token: 'a'.repeat(64), scheduled_appointment_id: null, completed_at: null, response: null, can_save_draft: true, can_complete: true, can_amend: false };
export const revision = { id: revisionId, patient_id: patientId, referral_id: referralId, version: 1, operation: 'draft_saved', status: 'accepted', to_service: context.to_service, priority: context.priority, completed_at: null, recorded_by_user_id: actorId, recorded_by_display_name: 'Synthetic response author', recorded_at: at, imported_legacy: false, specialist_notes: '  Synthetic exact reviewed notes  ', recommendations: '  Synthetic exact recommendations  ', amendment_reason: null };
export const receipt = { client_request_id: requestId, operation: 'draft_saved', replayed: false, recorded_at: at, response: revision };
export function metadata(value = revision) { const { specialist_notes: _notes, recommendations: _recommendations, amendment_reason: _reason, ...history } = value; return history; }
