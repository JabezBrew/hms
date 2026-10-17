import { useLayoutEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { advisoryApi } from './api';
import { advisoryKeys } from './keys';
import { AdvisoryEvidence } from './AdvisoryEvidence';
import { DECISIONS } from './model';
export function AdvisoryCurrent({ scope, patientId, caseId, id, open, context, canWrite, disabled, onDenied, onDecide }) {
  const detail = useQuery({ queryKey: advisoryKeys.detail(scope, patientId, caseId, id), queryFn: ({ signal }) => advisoryApi.detail({ patientId, caseId }, id, { signal }), enabled: open, staleTime: 0, retry: false, refetchOnMount: 'always' });
  useLayoutEffect(() => { if (detail.error?.status === 403) onDenied(); }, [detail.error, onDenied]);
  if (!open) return null;
  if (detail.error || !detail.isFetchedAfterMount || detail.isFetching || !detail.data) return <div className="rounded-xl border p-4 text-sm text-muted-foreground">{detail.error ? <>The current task could not be confirmed. <Button type="button" variant="link" onClick={() => detail.refetch()}>Refresh task</Button></> : 'Confirming the selected task and current access…'}</div>;
  const current = detail.data;
  const header = context.advisories.find((row) => row.id === id);
  if (!header || header.version !== current.version) return <p className="rounded-xl border p-4 text-sm">The task changed. <Button type="button" variant="link" onClick={() => detail.refetch()}>Refresh task</Button></p>;
  return <div className="space-y-4"><AdvisoryEvidence value={current} /><div className="flex flex-wrap gap-2">{Object.entries(DECISIONS).map(([decision, label]) => current[`can_${decision === 'completed' ? 'complete' : decision === 'cancelled' ? 'cancel' : 'acknowledge_unresolved'}`] && header[`can_${decision === 'completed' ? 'complete' : decision === 'cancelled' ? 'cancel' : 'acknowledge_unresolved'}`] && context[`can_${decision === 'completed' ? 'complete' : decision === 'cancelled' ? 'cancel' : 'acknowledge_unresolved'}`] && <Button key={decision} type="button" variant="outline" disabled={!canWrite || disabled} onClick={() => onDecide(decision, current)}>{label} follow-up</Button>)}</div></div>;
}
