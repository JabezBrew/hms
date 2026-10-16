import { afterEach, expect, it } from 'vitest';
import { buildChronicleWorkspaceProps } from '@/features/patients/chronicle/workspaceRegistry';
import { ids, encounterId, admissionId } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__;
afterEach(() => { window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('binds a Rust note draft to the explicitly selected encounter and admission', () => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; const selected = { id: encounterId, v2_status: 'in_progress' }; const props = buildChronicleWorkspaceProps('note', { activeEncounter: { id: ids[20] }, selectedEncounter: selected, selectedAdmissionId: admissionId }); expect(props.encounter).toBe(selected); expect(props.admissionId).toBe(admissionId);
});
it('keeps all-history notes unlinked instead of silently choosing a current encounter', () => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; expect(buildChronicleWorkspaceProps('note', { activeEncounter: { id: ids[20] }, selectedEncounter: null }).encounter).toBeNull();
});
it('preserves the legacy encounter selection contract', () => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' }; const active = { id: ids[20] }; expect(buildChronicleWorkspaceProps('note', { activeEncounter: active, selectedEncounter: { id: encounterId } }).encounter).toBe(active);
});
