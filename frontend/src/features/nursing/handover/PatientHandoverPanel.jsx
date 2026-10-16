import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { getV2ClientScopeKey } from '@/lib/api/v2/client';
import { authorizationScope } from '@/shared/lib/authorizationScope';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { userHasCapability } from '@/shared/lib/access';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { Button } from '@/components/ui/button';
import { handoverApi } from './api';
import { handoverKeys } from './keys';
import { HandoverUnavailable } from './HandoverUnavailable';
import { HandoverWorkspace } from './HandoverWorkspace';

function Entry({ open, onClose, patientId, admissionId, patientLabel, scope, actorId, canWrite }) {
  const [savedKnown, setSavedKnown] = useState(false);
  const [denied, setDenied] = useState(false); const [includeVoided, setIncludeVoided] = useState(false); const [allHistory, setAllHistory] = useState(false); const [cursor, setCursor] = useState(null); const [previous, setPrevious] = useState([]);
  const query = { patient_id: patientId, admission_case_id: allHistory ? undefined : admissionId || undefined, include_voided: includeVoided, cursor: cursor || undefined, limit: 25 };
  const list = useQuery({ queryKey: handoverKeys.list(scope, patientId, query), queryFn: ({ signal }) => handoverApi.list(query, { signal }), enabled: open && !denied, staleTime: 0, retry: false });
  const onDenied = useCallback(() => setDenied(true), []);
  const onSaved = useCallback(() => setSavedKnown(true), []);
  if (denied || list.error?.status === 403) return <HandoverUnavailable {...{ open, onClose }}>Current ward assignment and full clinical access could not be confirmed. Refresh your access before reviewing this handover.</HandoverUnavailable>;
  const ready = list.isSuccess && !list.isFetching;
  const controls = <div className="flex gap-2">{previous.length > 0 && <Button type="button" size="sm" variant="outline" onClick={() => { setCursor(previous.at(-1)); setPrevious((old) => old.slice(0, -1)); }}>Previous handovers</Button>}{list.data?.hasNext && <Button type="button" size="sm" variant="outline" onClick={() => { setPrevious((old) => [...old, cursor]); setCursor(list.data.cursor); }}>Next handovers</Button>}</div>;
  return <>{!ready && <HandoverUnavailable {...{ open, onClose }} title={list.isError ? 'Handovers unavailable' : 'Loading patient handovers'}>{list.isError ? <>{savedKnown ? 'The last reviewed change was saved. Current records could not refresh.' : 'This page could not be loaded.'} Earlier data is unavailable until the read succeeds. <Button type="button" variant="link" onClick={() => list.refetch()}>Refresh handovers</Button></> : 'Confirming current access and the selected page…'}</HandoverUnavailable>}<HandoverWorkspace {...{ onClose, patientId, admissionId, patientLabel, scope, actorId, canWrite, includeVoided, allHistory }} open={open && ready} list={{ data: list.data, controls }} onDenied={onDenied} onSaved={onSaved} onListFilter={() => { setIncludeVoided((value) => !value); setCursor(null); setPrevious([]); }} onHistoryScope={() => { setAllHistory((value) => !value); setCursor(null); setPrevious([]); }} /></>;
}
export default function PatientHandoverPanel(props) {
  const { user } = useAuth(); const access = useReadOnlyMode({ optional: true }); const context = user?.accessContext;
  const allowed = props.clinicalPermissions?.can_view_full_clinical === true && userHasCapability(user, 'nursing.task.manage') && context?.features?.includes('nursing') && context?.patient_visibility?.includes('full_clinical');
  const patientId = props.patient?.local_data?.id || props.patient?.id; const admissionId = props.admission?.id || null;
  const scope = hashQueryValue(JSON.stringify([authorizationScope(user, getV2ClientScopeKey()), access?.isReadOnly, access?.networkDecision?.policy_version, access?.networkDecision?.classification]));
  if (!allowed || !patientId) return <HandoverUnavailable open={props.open} onClose={props.onClose} />;
  const local = props.patient?.local_data || props.patient; const patientLabel = `${props.patient?.name || local?.name || 'Patient'} · ${local?.patient_code || local?.medical_record_number || local?.mrn || props.patient?.medical_record_number || props.patient?.code || 'Patient identifier unavailable'}`;
  return <Entry key={JSON.stringify([scope, patientId, admissionId])} {...props} {...{ patientId, admissionId, patientLabel, scope }} actorId={user.id} canWrite={!access?.isReadOnly} />;
}
