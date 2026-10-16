import { hashQueryValue } from '@/shared/lib/privateQueryKey';
export const INTAKE = { oral: 'Oral', iv: 'IV fluids', enteral: 'Enteral feed', blood: 'Blood products' };
export const OUTPUT = { urine: 'Urine', vomit: 'Vomit', stool: 'Stool', drain: 'Drain', ng_suction: 'NG suction', other: 'Other' };
export const emptyFluidValues = () => ({ recorded_at: new Date().toISOString().slice(0, 16), intake_ml: '', output_ml: '', metadata: { intake_category: '', output_category: '', intake_subcategory: '', output_subcategory: '', output_colour: '', notes: '' } });
export function formFromObservation(source) { return { ...source.values, recorded_at: source.values.recorded_at.slice(0, 16), metadata: { ...emptyFluidValues().metadata, ...source.values.metadata } }; }
export function valuesPayload(form, source) {
  const intake = Number(form.intake_ml); const output = Number(form.output_ml);
  if (!Number.isSafeInteger(intake) || !Number.isSafeInteger(output) || intake < 0 || output < 0 || (!intake && !output) || (intake > 10000 && source?.values.intake_ml !== intake) || (output > 10000 && source?.values.output_ml !== output)) throw new Error('Enter a positive whole volume, up to 10000 ml for each direction.');
  if ((intake > 0 && !form.metadata.intake_category && !(source?.values.intake_ml === intake && !source.values.metadata.intake_category)) || (output > 0 && !form.metadata.output_category && !(source?.values.output_ml === output && !source.values.metadata.output_category))) throw new Error('Choose a category for each measured direction.');
  const time = new Date(source && form.recorded_at === source.values.recorded_at.slice(0, 16) ? source.values.recorded_at : `${form.recorded_at}:00Z`);
  if (!Number.isFinite(time.getTime()) || time.getTime() > Date.now()) throw new Error('Choose a valid observation time at or before now (UTC).');
  return { recorded_at: time.toISOString(), intake_ml: intake, output_ml: output, metadata: { intake_category: intake ? form.metadata.intake_category || null : null, intake_subcategory: intake ? form.metadata.intake_subcategory?.trim() || null : null, output_category: output ? form.metadata.output_category || null : null, output_subcategory: output ? form.metadata.output_subcategory?.trim() || null : null, output_colour: output ? form.metadata.output_colour?.trim() || null : null, notes: form.metadata.notes?.trim() || null } };
}

export const fluidTime = (value) => new Date(value).toISOString().slice(0,16).replace('T',' ') + ' UTC';

/** Only opaque hashes of durable authorization evidence enter clinical keys. */
export function fluidAccessScope(user, clientScope) {
  const context = user?.accessContext || {};
  return hashQueryValue(JSON.stringify([clientScope, user?.id, context.facility_id, context.active_profile, context.session_version, context.permission_version,
    [...(user?.adminAccess?.capabilities || [])].sort(), [...(context.features || [])].sort(), [...(context.patient_visibility || [])].sort(), context.auth_security]));
}
