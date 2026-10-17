import { afterEach, expect, it } from 'vitest';
import { canMountChronicleWorkspace } from '@/features/patients/chronicle/workspaceRegistry';
const runtime = window.__HMS_RUNTIME_CONFIG__;
afterEach(() => { window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('requires authoritative Full proof for hosted full workflows and exact action grants for note/vitals/prescription', () => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
  const full = { clinicalPermissions: { can_view_full_clinical: true } };
  for (const id of ['note', 'vitals', 'prescription', 'handover', 'fluids', 'wardRound', 'treatmentSheet', 'medicationHistory', 'consultation', 'discharge', 'labs', 'referral', 'receiveRecord', 'copilot', 'crossFacility', 'noteTemplatePreview']) { expect(canMountChronicleWorkspace(id, {})).toBe(false); expect(canMountChronicleWorkspace(id, { clinicalPermissions: { can_view_full_clinical: false } })).toBe(false); }
  for (const [id, flag] of [['note', 'can_add_note'], ['vitals', 'can_record_vitals'], ['prescription', 'can_prescribe']]) { expect(canMountChronicleWorkspace(id, full)).toBe(false); expect(canMountChronicleWorkspace(id, { clinicalPermissions: { ...full.clinicalPermissions, [flag]: true } })).toBe(true); }
  expect(canMountChronicleWorkspace('handover', full)).toBe(true);
});
it('preserves demographic insurance and scalar vital trends but denies fluid trends without Full proof', () => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
  expect(canMountChronicleWorkspace('insurance', {})).toBe(true); expect(canMountChronicleWorkspace('trends', { initialTrendTab: 'vitals' })).toBe(true); expect(canMountChronicleWorkspace('trends', {})).toBe(true); expect(canMountChronicleWorkspace('trends', { initialTrendTab: 'fluids' })).toBe(false); expect(canMountChronicleWorkspace('trends', { initialTrendTab: 'fluids', clinicalPermissions: { can_view_full_clinical: true } })).toBe(true);
});

it('allows preview under authoritative Full read proof without an Add note grant', () => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; expect(canMountChronicleWorkspace('noteTemplatePreview', { clinicalPermissions: { can_view_full_clinical: true, can_add_note: false } })).toBe(true); });
