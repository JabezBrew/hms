import { useContext, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageState } from '@/shared/components/page/PageState';
import { NotePatientContext } from '../NotePatientContext';
import { useNoteAccess } from '../hooks/useNoteAccess';
import { useNoteCommand } from '../hooks/useNoteCommand';
import { noteWorkspaceApi } from '../api/workspace';
import { noteKeys } from '../keys';
import { NoteEvidence } from './NoteEvidence';
import { NoteHistory } from './NoteHistory';
import { NoteForm, NoteFormActions } from './NoteForm';
import { useNoteDraft } from '../hooks/useNoteDraft';
import { NoteCommandResult, NoteCommandActions } from './NoteCommandResult';
import { NoteUnavailable } from './NoteUnavailable';

function Workspace({ open, onClose, id, patient, scope, canWrite }) {
  const [mode, setMode] = useState('view'); const draft = useNoteDraft(); const controller = useNoteCommand(scope, patient.id);
  const [denied, setDenied] = useState(false);
  const canCreate = canWrite && (!patient.encounterId || ['in_progress', 'in-progress'].includes(patient.encounterStatus));
  const detail = useQuery({ queryKey: noteKeys.detail(scope, patient.id, id), queryFn: ({ signal }) => noteWorkspaceApi.detail(id, patient.id, { signal }), enabled: open && mode === 'view' && !controller.saved && !controller.unknown, retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always' });
  const close = () => { if (!controller.busy) onClose(); };
  const current = () => { controller.reset(); setMode('view'); };
  if (!open) return null;
  if (denied) return <NoteUnavailable {...{ open, onClose: close }} title="Note access denied">Current clinical access could not be confirmed. Previously loaded content is hidden. Refresh your access from the Chronicle before continuing.</NoteUnavailable>;
  return <Dialog open onOpenChange={(next) => { if (!next) close(); }}><DialogContent className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden sm:max-w-3xl" onEscapeKeyDown={(event) => { if (controller.busy) event.preventDefault(); }} onInteractOutside={(event) => { if (controller.busy) event.preventDefault(); }}><DialogHeader><DialogTitle>{mode === 'amend' ? 'Amend clinical note' : mode === 'copy' ? 'New note from reviewed source' : 'Clinical note'}</DialogTitle><DialogDescription>{patient.name} · {patient.code}</DialogDescription></DialogHeader><div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">
    {controller.saved || controller.unknown ? <NoteCommandResult {...{ controller, canWrite }} onCurrent={controller.saved ? current : undefined} /> : mode !== 'view' ? <NoteForm {...{ patient, scope, controller, draft }} canWrite={mode === 'copy' ? canCreate : canWrite} encounterId={patient.encounterId} /> : detail.isError ? <PageState fullHeight={false} variant="error" title={detail.error.status === 403 ? 'Note access denied' : 'Note unavailable'} description="Current note content and access could not be confirmed. Cached content is hidden." action={() => detail.refetch()} /> : !detail.isFetchedAfterMount || detail.isFetching || !detail.data ? <PageState fullHeight={false} variant="loading" title="Loading protected note" /> : <><NoteEvidence note={detail.data} />{canWrite && <div className="flex flex-wrap gap-2">{detail.data.can_amend && <Button type="button" variant="outline" onClick={() => { draft.start(detail.data); setMode('amend'); }}>Amend recorded note</Button>}<Button type="button" variant="outline" disabled={!canCreate} onClick={() => { draft.start(detail.data, true); setMode('copy'); }}>Use as a new note draft</Button></div>}{!detail.data.can_amend && <Alert><AlertDescription>You can read this record and its history. Amendment requires current author or explicit administrative authority.</AlertDescription></Alert>}<NoteHistory {...{ id, scope }} patientId={patient.id} onDenied={() => setDenied(true)} /></>}
  </div><DialogFooter className="shrink-0 flex-wrap gap-2 border-t pt-4">{controller.unknown ? <NoteCommandActions {...{ controller, canWrite }} /> : mode !== 'view' && !controller.saved && <NoteFormActions {...{ patient, controller, draft }} canWrite={mode === 'copy' ? canCreate : canWrite} encounterId={patient.encounterId} />}{mode !== 'view' && !controller.unknown && !controller.saved && <Button type="button" variant="ghost" disabled={controller.busy} onClick={current}>Discard draft and reload current note</Button>}<Button type="button" variant="outline" disabled={controller.busy} onClick={close}>Close</Button></DialogFooter></DialogContent></Dialog>;
}
export default function ClinicalNoteDialog({ entry, open, onOpenChange }) {
  const patient = useContext(NotePatientContext); const access = useNoteAccess();
  const onClose = () => onOpenChange(false);
  if (!access.canRead || !patient?.id || patient.id !== entry.patient_id) return <NoteUnavailable {...{ open, onClose }} />;
  return <Workspace key={JSON.stringify([access.scope, patient.id, entry.id, patient.encounterId, patient.encounterStatus, patient.admissionId])} {...{ open, onClose, patient, id: entry.id }} {...access} />;
}
