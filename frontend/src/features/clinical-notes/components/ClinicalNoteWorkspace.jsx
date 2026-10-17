import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useNoteAccess } from '../hooks/useNoteAccess';
import { useNoteCommand } from '../hooks/useNoteCommand';
import { patientContext } from '../model';
import { NoteForm, NoteFormActions } from './NoteForm';
import { useNoteDraft } from '../hooks/useNoteDraft';
import { NoteCommandResult, NoteCommandActions } from './NoteCommandResult';
import { NoteUnavailable } from './NoteUnavailable';
import { inferClinicalNoteTypeForRole } from '../noteTypes';

function Workspace({ open, onClose, patient, encounterId, scope, canWrite, onNoteCreated, noteDraftOverrides, user, canPreviewTemplates, onPreviewDenied, previewOnly = false }) {
  const draft = useNoteDraft({ title: noteDraftOverrides?.title || '', note_type: noteDraftOverrides?.noteType || inferClinicalNoteTypeForRole(user?.role || user?.user_type), body: '' });
  const controller = useNoteCommand(scope, patient.id);
  const close = () => { if (!controller.busy) onClose(); };
  if (!open) return null;
  return <Dialog open onOpenChange={(next) => { if (!next) close(); }}><DialogContent className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden sm:max-w-3xl" onEscapeKeyDown={(event) => { if (controller.busy) event.preventDefault(); }} onInteractOutside={(event) => { if (controller.busy) event.preventDefault(); }}><DialogHeader><DialogTitle>{previewOnly ? 'Preview note template' : 'New clinical note'}</DialogTitle><DialogDescription>{patient.name} · {patient.code}{previewOnly ? " · Local unsaved preview. This panel saves nothing." : ""}</DialogDescription></DialogHeader><div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">{controller.saved || controller.unknown ? <NoteCommandResult {...{ controller, canWrite }} /> : <NoteForm {...{ patient, encounterId, scope, controller, canWrite, draft, previewOnly, canPreviewTemplates, onPreviewDenied }} />}</div><DialogFooter className="shrink-0 flex-wrap gap-2 border-t pt-4">{controller.unknown ? <NoteCommandActions {...{ controller, canWrite }} /> : !previewOnly && !controller.saved && <NoteFormActions {...{ patient, encounterId, controller, canWrite, draft }} />}{controller.saved && <Button type="button" onClick={() => { try { onNoteCreated?.(); } finally { close(); } }}>Return to Chronicle</Button>}<Button type="button" variant="outline" disabled={controller.busy} onClick={close}>Close</Button></DialogFooter></DialogContent></Dialog>;
}
function AccessCheckedWorkspace(props) {
  const [denied, setDenied] = useState(false);
  if (denied) return <NoteUnavailable open={props.open} onClose={props.onClose} onRetry={() => setDenied(false)} retryLabel="Start a new empty preview" title="Template preview access unavailable">Current patient or template access could not be confirmed. Protected previews and local copies have been cleared. Start empty to choose a revision again. The next generated preview checks current patient access.</NoteUnavailable>;
  return <Workspace {...props} onPreviewDenied={() => setDenied(true)} />;
}
export default function ClinicalNoteWorkspace(props) {
  const access = useNoteAccess(); const patient = patientContext(props.patient); const encounterId = props.encounter?.id || null;
  if ((props.previewOnly && !access.canPreviewTemplates) || !access.canRead || (!props.previewOnly && !access.canWrite) || !patient.id) return <NoteUnavailable open={props.open} onClose={props.onClose}>{props.previewOnly ? 'Current Full clinical read access, patient and encounter features, and documentation view permission are required for patient-aware preview.' : access.readonlyMessage || 'Current full clinical access and note-writing permission are required.'}</NoteUnavailable>;
  const encounterStatus = props.encounter?.v2_status || props.encounter?.status;
  if (!props.previewOnly && encounterId && !['in_progress', 'in-progress'].includes(encounterStatus)) return <NoteUnavailable open={props.open} onClose={props.onClose} title="Selected encounter unavailable for new notes">Choose an active encounter in Chronicle before linking a new note. Earlier notes remain readable and can be amended when authorized.</NoteUnavailable>;
  return <AccessCheckedWorkspace key={JSON.stringify([access.scope, patient.id, encounterId, encounterStatus, props.admissionId || null, Boolean(props.previewOnly)])} {...props} {...access} patient={patient} encounterId={encounterId} />;
}
