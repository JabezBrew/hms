import { useLayoutEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { advisoryApi } from './api';
import { advisoryKeys } from './keys';
import { advisoryPayload, draftIsStale, ADVISORY_TYPES, ADVISORY_STATUS, CASE_STATUS } from './model';
import { useAdvisoryCommand } from './useAdvisoryCommand';
import { AdvisoryCasePicker } from './AdvisoryCasePicker';
import { AdvisoryCurrent } from './AdvisoryCurrent';
import { AdvisoryForm } from './AdvisoryForm';
import { AdvisoryResult } from './AdvisoryResult';

export function AdvisoryWorkspace({ open, onClose, access, patientId, caseId, label, onCaseChange, onDenied }) {
  const client = useQueryClient();
  const refreshEvidence = () => client.invalidateQueries({ queryKey: advisoryKeys.context(access.scope, patientId, caseId) });
  const context = useQuery({ queryKey: advisoryKeys.context(access.scope, patientId, caseId), queryFn: ({ signal }) => advisoryApi.context({ patientId, caseId }, { signal }), enabled: open && Boolean(caseId), retry: false, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true });
  const command = useAdvisoryCommand(access.scope, patientId, caseId, onDenied);
  const [selected, setSelected] = useState(null); const [draft, setDraft] = useState(null); const [reviewed, setReviewed] = useState(false);
  useLayoutEffect(() => { if (context.error?.status === 403) onDenied(); }, [context.error, onDenied]);
  const ready = context.isSuccess && context.isFetchedAfterMount && !context.isFetching && !context.error;
  const stale = draftIsStale(draft, context.data);
  const validation = useMemo(() => { if (!draft) return {}; try { return { payload: advisoryPayload(draft) }; } catch (error) { return { error: error.message }; } }, [draft]);
  const locked = command.locked || !access.canWrite || stale || !ready;
  const begin = (kind, decision = null, source = null) => {
    if (!ready || command.locked || !access.canWrite) return;
    setDraft({ kind, decision, source: source ? structuredClone(source) : null, context: structuredClone(context.data), taskType: '', notes: '', reason: '', requestId: crypto.randomUUID() }); setReviewed(false);
  };
  const submit = () => {
    if (locked || !reviewed || !validation.payload) return;
    command.run({ kind: draft.kind, payload: validation.payload, source: draft.source, context: draft.context, patientId, caseId, actorId: access.user.id });
  };
  const close = () => { if (!command.pending) onClose(); };
  const browse = () => { const id = command.saved?.advisory.id; command.reset(); setDraft(null); setReviewed(false); setSelected(id || null); context.refetch(); };
  if (!open) return null;
  return <Dialog open onOpenChange={(next) => { if (!next) close(); }}><DialogContent className="flex max-h-[90dvh] min-w-0 flex-col overflow-hidden sm:max-w-5xl" onEscapeKeyDown={(event) => { if (command.pending) event.preventDefault(); }} onInteractOutside={(event) => { if (command.pending) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>Admission follow-up</DialogTitle><DialogDescription className="min-w-0 break-words leading-6">{label}. This shared checklist does not clear admission blockers, finish intake or prevent discharge. No notification is sent.</DialogDescription></DialogHeader>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
      <AdvisoryCasePicker scope={access.scope} patientId={patientId} open={open} selectedId={caseId} disabled={command.pending || command.unknown || Boolean(draft)} onSelect={onCaseChange} onDenied={onDenied} />
      {!caseId ? <p className="rounded-xl border p-5 text-sm text-muted-foreground">Choose an admission case to review its follow-up. No current admission is selected automatically.</p> : !ready ? <div className="space-y-3 rounded-xl border p-5 text-sm">{command.saved && <p role="status">The original follow-up change is confirmed. Current details could not be refreshed.</p>}{command.unknown && <p>A prior change may already be recorded. Its unchanged request is retained.</p>}<p>{context.error ? 'Current admission access and follow-up records could not be confirmed.' : 'Confirming the selected admission and current access…'}</p>{context.error && <Button type="button" variant="outline" onClick={() => context.refetch()}>Refresh follow-up</Button>}</div> : <>
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-muted/10 p-4"><div><h3 className="font-medium">{context.data.current_ward_name}</h3><p className="mt-1 text-sm text-muted-foreground">Selected admission case · {CASE_STATUS[context.data.admission_status]}</p></div><Button type="button" size="sm" variant="outline" disabled={command.pending} onClick={refreshEvidence}>Refresh current evidence</Button></div>
        {!access.canWrite && <p className="rounded-lg border p-3 text-sm text-muted-foreground">This connection has review access. Follow-up changes are unavailable.</p>}
        {command.saved || command.unknown ? <AdvisoryResult command={command} canWrite={access.canWrite} onCurrent={browse} /> : draft ? <>
          {stale && <div role="alert" className="space-y-3 rounded-lg border p-4 text-sm"><p>The admission context or task changed. Your copied review has not overwritten it.</p><Button type="button" variant="outline" disabled={command.pending} onClick={() => { setDraft(null); setReviewed(false); command.reset(); context.refetch(); }}>Discard draft and reload</Button></div>}
          <AdvisoryForm draft={draft} disabled={locked} reviewed={reviewed} onReview={setReviewed} onChange={(value) => { setDraft(value); setReviewed(false); }} />
          {validation.error && <p role="alert" className="text-sm text-destructive">{validation.error}</p>}{command.error && <p role="alert" className="text-sm text-destructive">{command.error}</p>}
        </> : <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]"><section className="space-y-3"><div className="flex flex-wrap gap-2 text-xs text-muted-foreground">{Object.entries(context.data.counts_by_status).map(([status, count]) => <span key={status}>{ADVISORY_STATUS[status]}: {count}</span>)}</div>{context.data.can_create && <Button type="button" variant="outline" disabled={!access.canWrite} onClick={() => begin('create')}>Add follow-up</Button>}<div className="grid gap-2">{context.data.advisories.map((item) => <Button key={item.id} type="button" variant={selected === item.id ? 'secondary' : 'outline'} className="h-auto justify-between gap-2 whitespace-normal py-3 text-left" onClick={() => setSelected(item.id)}><span>{ADVISORY_TYPES[item.task_type]}</span><Badge variant="outline">{ADVISORY_STATUS[item.status]}</Badge></Button>)}</div>{!context.data.advisories.length && <p className="text-sm text-muted-foreground">No follow-up tasks are recorded for this case.</p>}</section><div className="min-w-0">{selected ? <AdvisoryCurrent key={selected} scope={access.scope} patientId={patientId} caseId={caseId} id={selected} open={ready && open} context={context.data} canWrite={access.canWrite} disabled={command.locked} onDenied={onDenied} onDecide={(decision, source) => begin('decision', decision, source)} /> : <p className="rounded-xl border p-5 text-sm text-muted-foreground">Select a follow-up to read its note and recorded outcome. Each type is recorded once per admission case.</p>}</div></div>}
      </>}
    </div>
    <DialogFooter className="shrink-0 flex-wrap gap-2 border-t pt-4">{ready && draft && !command.saved && !command.unknown && <><Button type="button" variant="outline" disabled={command.pending} onClick={() => { setDraft(null); setReviewed(false); command.reset(); }}>Discard draft</Button><Button type="button" disabled={locked || !reviewed || !validation.payload} onClick={submit}>{command.pending ? 'Recording…' : 'Confirm reviewed change'}</Button></>}<Button type="button" variant="outline" disabled={command.pending} onClick={close}>Close</Button></DialogFooter>
  </DialogContent></Dialog>;
}
