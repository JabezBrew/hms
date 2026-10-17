import { useLayoutEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { advisoryApi } from './api';
import { advisoryKeys } from './keys';
import { CASE_STATUS } from './model';
import { EvidenceTime } from './AdvisoryEvidence';

export function AdvisoryCasePicker({ scope, patientId, open, selectedId, disabled, onSelect, onDenied }) {
  const [closed, setClosed] = useState(false); const [cursor, setCursor] = useState(null); const [previous, setPrevious] = useState([]);
  const query = { include_closed: closed, limit: 25, ...(cursor ? { cursor } : {}) };
  const list = useQuery({ queryKey: advisoryKeys.cases(scope, patientId, query), queryFn: ({ signal }) => advisoryApi.cases(patientId, query, { signal }), enabled: open, retry: false, staleTime: 0, refetchOnMount: 'always' });
  useLayoutEffect(() => { if (list.error?.status === 403) onDenied(); }, [list.error, onDenied]);
  if (!open) return null;
  const ready = list.isSuccess && list.isFetchedAfterMount && !list.isFetching;
  const repeated = list.data?.hasNext && previous.includes(list.data.cursor);
  return <section aria-label="Admission case selection" className="space-y-3 rounded-xl border bg-muted/10 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-medium">Choose the admission case</h3><div className="flex items-center gap-2"><Checkbox id="advisory-closed-cases" checked={closed} disabled={disabled} onCheckedChange={(value) => { setClosed(value === true); setCursor(null); setPrevious([]); }} /><Label htmlFor="advisory-closed-cases" className="text-xs">Include closed cases</Label></div></div>
    {!ready ? <div className="text-sm text-muted-foreground">{list.isError ? <>Admission cases could not be loaded. <Button type="button" variant="link" onClick={() => list.refetch()}>Refresh cases</Button></> : 'Confirming available admission cases…'}</div> : <>
      {!list.data.rows.length && <p className="text-sm text-muted-foreground">No admission cases are available within your current clinical and ward access.</p>}
      <div className="grid gap-2 sm:grid-cols-2">{list.data.rows.map((item) => <Button key={item.admission_case_id} type="button" variant={selectedId === item.admission_case_id ? 'secondary' : 'outline'} className="h-auto min-w-0 justify-start whitespace-normal py-3 text-left" disabled={disabled} aria-pressed={selectedId === item.admission_case_id} onClick={() => onSelect(item.admission_case_id)}><span className="grid min-w-0 gap-1 [overflow-wrap:anywhere]"><span>{item.current_ward_name} · {CASE_STATUS[item.admission_status]}</span><span className="text-xs font-normal text-muted-foreground"><EvidenceTime value={item.created_at} /></span></span></Button>)}</div>
      {repeated && <p role="alert" className="text-sm text-destructive">The page could not advance safely. Refresh the case list.</p>}
      <div className="flex gap-2">{previous.length > 0 && <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => { setCursor(previous.at(-1)); setPrevious((old) => old.slice(0, -1)); }}>Previous cases</Button>}{list.data.hasNext && <Button type="button" size="sm" variant="outline" disabled={disabled || repeated} onClick={() => { setPrevious((old) => [...old, cursor]); setCursor(list.data.cursor); }}>Next cases</Button>}</div>
    </>}
  </section>;
}
