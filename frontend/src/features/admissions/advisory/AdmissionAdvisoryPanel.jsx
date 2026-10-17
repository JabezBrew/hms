import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAdvisoryAccess } from './useAdvisoryAccess';
import { patientLabel, uuid } from './model';
import { AdvisoryWorkspace } from './AdvisoryWorkspace';
function Unavailable({ open, onClose, onRecheck }) {
  if (!open) return null;
  return <Dialog open onOpenChange={(next) => { if (!next) onClose?.(); }}><DialogContent><DialogHeader><DialogTitle>Admission follow-up unavailable</DialogTitle><DialogDescription>Current full clinical access, admission permission, patient relationship and ward access could not be confirmed. Earlier clinical content is unavailable.</DialogDescription></DialogHeader>{onRecheck && <Button type="button" variant="outline" onClick={onRecheck}>Recheck current access</Button>}<Button type="button" variant="outline" onClick={onClose}>Close</Button></DialogContent></Dialog>;
}
function ScopedPanel({ open, onClose, access, patientId, label, requestedCaseId, selectedAdmissionId }) {
  const [caseId, setCaseId] = useState(() => uuid(requestedCaseId) ? requestedCaseId : uuid(selectedAdmissionId) ? selectedAdmissionId : null);
  const [denied, setDenied] = useState(false); const [generation, setGeneration] = useState(0); const requested = useRef(null);
  const onDenied = useCallback(() => setDenied(true), []);
  useLayoutEffect(() => {
    // A deep link is an explicit external navigation command; ordinary close
    // clears options without discarding the retained same-case request.
    if (!open) requested.current = null;
    else if (uuid(requestedCaseId) && requested.current !== requestedCaseId) { requested.current = requestedCaseId; setCaseId(requestedCaseId); }
  }, [open, requestedCaseId]);
  if (denied) return <Unavailable {...{ open, onClose }} onRecheck={() => { setGeneration((old) => old + 1); setDenied(false); }} />;
  return <AdvisoryWorkspace key={`${caseId || 'selection'}:${generation}`} {...{ open, onClose, access, patientId, label, caseId, onDenied }} onCaseChange={setCaseId} />;
}
export default function AdmissionAdvisoryPanel(props) {
  const access = useAdvisoryAccess(props.clinicalPermissions); const patientId = props.patient?.local_data?.id || props.patient?.id;
  if (!access.canRead || !uuid(patientId) || (props.requestedCaseId != null && !uuid(props.requestedCaseId))) return <Unavailable open={props.open} onClose={props.onClose} />;
  return <ScopedPanel key={JSON.stringify([access.scope, patientId, props.selectedAdmissionId || null, props.allHistory === true])} {...props} access={access} patientId={patientId} label={patientLabel(props.patient)} selectedAdmissionId={props.allHistory ? null : props.selectedAdmissionId} />;
}
