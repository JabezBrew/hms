import { useLayoutEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { handoverApi } from './api';
import { handoverKeys } from './keys';
import { HandoverEvidence } from './HandoverEvidence';
import { HandoverHistory } from './HandoverHistory';

export function HandoverCurrent({ selected, scope, patientId, admissionId, open, onDenied, canWrite, actorId, onStart }) {
  const [showHistory, setShowHistory] = useState(false);
  const detail = useQuery({ queryKey: handoverKeys.detail(scope, patientId, selected), queryFn: ({ signal }) => handoverApi.detail(selected, { patientId }, { signal }), enabled: open, staleTime: 0, retry: false });
  useLayoutEffect(() => { if (detail.error?.status === 403) onDenied(); }, [detail.error?.status, onDenied]);
  if (detail.isError) return <p role="alert">The current handover could not be confirmed. <Button type="button" variant="link" onClick={() => detail.refetch()}>Refresh handover</Button></p>;
  if (detail.isFetching || !detail.data) return <p role="status">Loading current handover…</p>;
  const source = detail.data;
  return <>
    <p className="text-sm text-muted-foreground">{source.ward_name} · {admissionId && source.admission_case_id !== admissionId ? 'Earlier admission' : 'Recorded admission'} · Original author: {source.author_display_name}</p>
    <HandoverEvidence revision={source.current} />
    {source.status === 'voided' && <p className="text-sm text-muted-foreground">Voided report. Original and correction evidence remain in history.</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={() => setShowHistory((value) => !value)}>Review history</Button>
      {canWrite && source.author_user_id === actorId && source.status === 'recorded' && <>
        <Button type="button" variant="outline" onClick={() => onStart('amend', source)}>Correct handover</Button>
        <Button type="button" variant="ghost" onClick={() => onStart('void', source)}>Void handover</Button>
      </>}
    </div>
    {showHistory && <HandoverHistory root={source} {...{ scope, patientId, open, onDenied }} />}
  </>;
}
