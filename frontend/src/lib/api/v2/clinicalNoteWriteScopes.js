import { noteDetail } from '@/features/clinical-notes/api/workspace';
import { validId } from '@/features/clinical-notes/model';
import { prepareWriteIntent } from './writeReplayPolicy';

// The server owns original-receipt actor binding. The author of an amended
// note may be another clinician and must never stand in for that actor proof.
export function classifyClinicalNoteReceipt(path) {
  const match = /^\/api\/v2\/patients\/([^/]+)\/clinical\/note-requests\/([^/]+)$/.exec(path);
  if (!match || !validId(match[1]) || !validId(match[2])) return { excludeRead: true };
  let copied;
  const receipt = response => {
    if (copied) return copied;
    const value = structuredClone(response?.data);
    if (!value || Object.keys(value).length !== 5 || !['client_request_id', 'action', 'reason', 'note', 'replayed'].every(key => Object.hasOwn(value, key)) || value.client_request_id !== match[2] || typeof value.replayed !== 'boolean') throw new Error('Original note receipt unavailable.');
    const note = noteDetail(value.note, { patientId: match[1] });
    if (value.action === 'recorded') {
      if (note.version !== 1 || note.status !== 'draft' || value.reason !== null) throw new Error('Original note receipt unavailable.');
    } else if (value.action === 'amended') {
      if (note.version < 2 || note.status !== 'amended' || typeof value.reason !== 'string' || !value.reason.trim()) throw new Error('Original note receipt unavailable.');
    } else throw new Error('Original note receipt unavailable.');
    copied = value; return value;
  };
  return {
    receiptRequestId: match[2],
    readFamily: response => receipt(response).action === 'amended' ? 'api/v2/clinical/notes' : `api/v2/patients/${match[1]}`,
    receiptMatches: (response, principal) => { try { receipt(response); return validId(principal?.id); } catch { return false; } },
    receiptFingerprint: async (response, digest) => {
      const value = receipt(response); if (value.action !== 'amended') return null;
      const request = { path: '/api/v2/clinical/notes/{note_id}/amendments', resolvedPath: `/api/v2/clinical/notes/${value.note.id}/amendments`, query: {}, body: { client_request_id: value.client_request_id, expected_version: value.note.version - 1, reason: value.reason, body: value.note.body } };
      return digest(prepareWriteIntent(request, 'POST').input);
    },
  };
}
