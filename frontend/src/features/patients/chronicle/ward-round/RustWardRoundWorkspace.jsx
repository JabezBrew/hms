import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useNoteAccess } from '@/features/clinical-notes/hooks/useNoteAccess';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { patientKeys } from '@/features/patients/hooks/usePatientQueries';
import { invalidatePatientTimelineQueries } from '@/hooks/useTimelineQueries';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { roundCommandApi } from './commandApi';
import { buildRoundDraft, canonical } from './commandModel';
import { RoundCommandActions } from './RoundCommandActions';
import { roundForm, unavailableRoundActions } from './roundForm';
import { useRoundCommand } from './useRoundCommand';

const placeholderUuid = '00000000-0000-4000-8000-000000000001';
function reviewedSnapshot(round) { return round ? { note_sections: round.note_sections, rendered_note: round.rendered_note, actions: round.actions.filter((row) => row.status === 'draft').map((row) => ({ action_type: row.action_type, payload: row.payload })) } : null; }
function snapshot(wire) { return { note_sections: wire.note_sections, rendered_note: wire.rendered_note, actions: wire.actions }; }
function RoundEditor({ patientId, admissionId, workspace, command, medications, canWrite, onSave, onCommit, onDenied, onReload, visible = true }) {
  const [base] = useState(() => workspace.ward_round ? structuredClone(workspace.ward_round) : null);
  const [form, setForm] = useState(() => roundForm(patientId, admissionId, base));
  const [reviewed, setReviewed] = useState(false);
  const unavailable = unavailableRoundActions(form, workspace.permissions);
  const setReviewedForm = (updater) => { setReviewed(false); setForm(updater); };
  const validation = useMemo(() => {
    try {
      if (form.unsupportedActions.length) throw new Error('Review and explicitly remove unsupported earlier actions before saving this draft.');
      if (unavailable.length) throw new Error('Saved actions require permissions that are currently unavailable. Review them below before changing this draft.');
      return { wire: buildRoundDraft(form, base, placeholderUuid), error: null };
    } catch (error) { return { wire: null, error: error.message }; }
  }, [form, base, unavailable.length]);
  const stale = (base?.id ?? null) !== (workspace.ward_round?.id ?? null) || (base?.version ?? 0) !== (workspace.ward_round?.version ?? 0);
  const dirty = !base || !validation.wire || base.actions.some((row) => row.status === 'draft' && row.position == null) || canonical(snapshot(validation.wire)) !== canonical(reviewedSnapshot(base));
  const disabled = !canWrite || !workspace.permissions.can_edit_draft || command.busy || stale;
  const hasNote = Boolean(form.renderedNote?.trim() || Object.values(form.preservedSections).some((value) => typeof value === 'string' && value.trim()));
  const save = () => onSave({ ...validation.wire, client_request_id: crypto.randomUUID() });
  const commit = () => onCommit(base, reviewedSnapshot(base));
  if (!visible) return null;
  return <div className="space-y-5">
    {stale && <Alert variant="destructive"><AlertTitle>The saved round changed</AlertTitle><AlertDescription>Your copied draft has not overwritten it. Reload the saved draft to discard copied edits and review the current version.</AlertDescription><Button className="mt-3" variant="outline" disabled={command.busy} onClick={onReload}>Discard copied edits and reload</Button></Alert>}
    {!canWrite && <Alert><AlertDescription>This connection has review access. Round changes are unavailable.</AlertDescription></Alert>}
    <fieldset disabled={disabled} className="space-y-5 disabled:opacity-75"><section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6"><div><h3 className="font-heading text-xl">Round note</h3><p className="mt-1 text-sm text-muted-foreground">Review the exact narrative that will be saved with the selected admission.</p></div><div className="space-y-2"><Label htmlFor="reviewed-round-narrative">Clinical narrative</Label><Textarea id="reviewed-round-narrative" rows={10} value={form.renderedNote} maxLength={32000} onChange={(event) => setReviewedForm((old) => ({ ...old, renderedNote: event.target.value }))} placeholder="Overnight events, examination, assessment and plan" className="resize-y text-sm leading-7" /></div>
      {Object.entries(form.preservedSections).some(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value)) && <details className="rounded-lg border bg-muted/20 p-3"><summary className="cursor-pointer text-sm font-medium">Saved structured context</summary><p className="my-2 text-xs text-muted-foreground">Structured content from this draft. Saving normalizes surrounding whitespace; editing the narrative does not regenerate these fields.</p><dl className="space-y-3">{Object.entries(form.preservedSections).filter(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value)).map(([key, value]) => value && <div key={key}><dt className="text-xs capitalize text-muted-foreground">{{ interval_history: 'Interval history', examination: 'Examination', assessment: 'Assessment', plan: 'Plan', clinical_readiness_blockers: 'Earlier readiness notes' }[key]}</dt><dd className="whitespace-pre-wrap text-sm">{Array.isArray(value) ? value.join('\n') : value}</dd></div>)}</dl></details>}
    </section>
    {base?.actions.some((row) => row.status === 'cancelled') && <section className="space-y-3 rounded-xl border bg-muted/20 p-4"><h3 className="text-sm font-medium">Cancelled earlier draft actions</h3><p className="text-xs text-muted-foreground">Retained evidence. These actions will not execute with this round.</p>{base.actions.filter((row) => row.status === 'cancelled').map((row) => <div key={row.id} className="rounded-lg border p-3"><p className="text-sm font-medium">{row.title || 'Cancelled action'}</p>{row.instruction && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{row.instruction}</p>}</div>)}</section>}
    {form.unsupportedActions.map((action) => <Alert key={action.id}><AlertTitle>{action.title}</AlertTitle><AlertDescription>This earlier action needs a new explicit review in its supported clinical panel.</AlertDescription><Button className="mt-3" variant="outline" onClick={() => setReviewedForm((old) => ({ ...old, unsupportedActions: old.unsupportedActions.filter((row) => row.id !== action.id) }))}>Remove earlier action from this draft</Button></Alert>)}
    {unavailable.map((group) => <Alert key={group.key}><AlertTitle>{group.title} need current permission</AlertTitle><AlertDescription>These saved draft actions remain part of the round. Current permission for this category is unavailable; review or explicitly remove them before saving.<ul className="mt-2 list-disc space-y-1 pl-5">{group.rows.map((row) => <li key={row.id || group.key}>{group.label(row)}</li>)}</ul></AlertDescription><Button className="mt-3" variant="outline" onClick={() => setReviewedForm((old) => ({ ...old, [group.key]: group.key === 'discharge' ? { ...old.discharge, request_discharge: false } : [] }))}>Remove saved {group.title.toLowerCase()} from this draft</Button></Alert>)}
    <RoundCommandActions form={form} setForm={setReviewedForm} permissions={workspace.permissions} medications={medications} onDenied={onDenied} />
    </fieldset>
    {validation.error && <p role="alert" className="text-sm text-destructive">{validation.error}</p>}
    <section className="sticky bottom-4 z-10 space-y-3 rounded-xl border bg-card p-4 shadow-lg sm:p-5"><div className="flex items-start gap-3"><Checkbox id="review-round-command" checked={reviewed} disabled={disabled || Boolean(validation.error)} onCheckedChange={(value) => setReviewed(value === true)} /><Label htmlFor="review-round-command" className="text-sm leading-6">I reviewed this note and every selected action for this admission.</Label></div><p className="text-xs text-muted-foreground">{validation.wire?.actions.length || 0} selected actions · saving a draft does not execute them. Completing a reviewed saved round executes its actions together.</p><div className="flex flex-wrap gap-3"><Button variant="outline" disabled={disabled || !reviewed || Boolean(validation.error) || !dirty} onClick={save}>Save reviewed draft</Button><Button disabled={disabled || !reviewed || dirty || !base || !workspace.permissions.can_commit || !hasNote} onClick={commit}>Complete reviewed round</Button></div>{dirty && <p className="text-xs text-muted-foreground">Save the reviewed draft before completing this round.</p>}</section>
  </div>;
}
function ScopedRoundWorkspace({ patientId, patient, admissionId, medications, onCommitted, access }) {
  const client = useQueryClient(); const [generation, setGeneration] = useState(0); const [denied, setDenied] = useState(false);
  const key = ['ward-round-command', access.scope, hashQueryValue(patientId), hashQueryValue(admissionId)];
  const queryFn = ({ signal }) => roundCommandApi.current(patientId, admissionId, { signal });
  const current = useQuery({ queryKey: key, queryFn, retry: false, staleTime: 0 });
  const command = useRoundCommand(hashQueryValue(`${access.scope}:${patientId}:${admissionId}`), async (saved, _input, isCurrent) => {
    await client.fetchQuery({ queryKey: key, queryFn, staleTime: 0, retry: false });
    if (!isCurrent()) return;
    setGeneration((old) => old + 1);
    if (saved.operation === 'committed') {
      await Promise.all([invalidatePatientTimelineQueries(client, patientId), client.invalidateQueries({ queryKey: patientKeys.chronicleStartup(patientId) })]);
      if (isCurrent()) onCommitted?.();
    }
  });
  const newDraft = (wire) => command.run({ kind: 'draft', patientId, admissionId, actorId: access.user.id, wire });
  const commit = (round, reviewed) => command.run({ kind: 'commit', patientId, admissionId, actorId: access.user.id, roundId: round.id, wire: { client_request_id: crypto.randomUUID(), expected_version: round.version }, reviewed });
  const refresh = async () => { const result = await current.refetch(); if (result.data && !result.error) setDenied(false); return result; };
  const reload = async () => { const result = await refresh(); if (result.data && !result.error) setGeneration((old) => old + 1); };
  const editor = (visible = true) => <RoundEditor key={generation} visible={visible} patientId={patientId} admissionId={admissionId} workspace={current.data} command={command} medications={medications} canWrite={access.canWrite && !current.isFetching} onSave={newDraft} onCommit={commit} onDenied={() => setDenied(true)} onReload={reload} />;
  if (current.isLoading || !current.isFetchedAfterMount) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-80" /></div>;
  if (denied || current.error || !current.data) return <div className="space-y-4">{command.saved && <Alert><AlertDescription>The original {command.saved.operation === 'committed' ? 'round completion' : 'draft save'} is confirmed. Current clinical access and refreshed details are unavailable; further changes remain locked.</AlertDescription></Alert>}{command.unknown && <Alert><AlertDescription>A prior round change may already be saved. Its recovery state is retained; a failed read does not authorize another save.</AlertDescription></Alert>}<Alert variant="destructive"><AlertTitle>Round workspace unavailable</AlertTitle><AlertDescription>Current admission access and saved evidence could not be confirmed. Refresh before continuing.</AlertDescription><Button className="mt-3" variant="outline" onClick={refresh}>Refresh workspace</Button></Alert>{current.data && !denied && current.error?.status !== 403 && editor(false)}</div>;
  const complete = command.saved?.operation === 'committed';
  return <div className="mx-auto max-w-5xl space-y-5"><header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-3xl">Ward Round</h2><p className="mt-2 text-sm text-muted-foreground">{patient?.name || patient?.display_name || 'Selected patient'}{patient?.patient_code ? ` · ${patient.patient_code}` : ''}</p><p className="mt-1 text-xs text-muted-foreground">Selected admission · {current.data.admission_status.replaceAll('_', ' ')}</p></div><Button variant="outline" disabled={command.pending} onClick={refresh}>Refresh saved evidence</Button></header>
    {command.pending && <p role="status" className="text-sm text-muted-foreground">Confirming the reviewed round change…</p>}
    {command.error && <Alert variant="destructive"><AlertTitle>{command.unknown ? 'Save status unknown' : 'Round not saved'}</AlertTitle><AlertDescription>{command.error}</AlertDescription></Alert>}
    {(command.unknown || command.refreshFailed) && <div className="flex flex-wrap gap-3"><Button disabled={command.pending} variant="outline" onClick={command.recover}>Check original saved result</Button>{command.unknown && <Button disabled={command.pending} variant="outline" onClick={command.retry}>Retry exact reviewed request</Button>}</div>}
    {command.refreshFailed && <Alert><AlertDescription>The original save is confirmed. The current workspace could not refresh; further changes remain locked.</AlertDescription></Alert>}
    {command.saved && !command.unknown && <Alert><AlertTitle>{complete ? 'Round completed' : 'Draft saved'}</AlertTitle><AlertDescription>{complete ? 'The reviewed note and action results are retained in the patient Chronicle.' : 'The exact reviewed draft is saved. Review it again before completing the round.'}</AlertDescription>{complete && <details className="mt-3 w-full"><summary className="cursor-pointer text-sm font-medium">Review the completed round</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-7">{command.saved.ward_round.rendered_note}</p><ul className="mt-3 space-y-2 text-sm">{command.saved.created_artifacts.map((row) => <li key={`${row.resource_type}:${row.resource_id}`}>{row.title}</li>)}</ul></details>}</Alert>}
    {!complete && editor()}
  </div>;
}
export default function RustWardRoundWorkspace(props) {
  const noteAccess = useNoteAccess(); const network = useReadOnlyMode({ optional: true });
  const access = { ...noteAccess, canWrite: noteAccess.canWrite && network?.networkConfirmed === true && network.canRead === true && network.isReadOnly === false };
  const admissionId = props.admission?.admission_id || props.admission?.id || props.admission?.admission_case_id || null;
  if (!access.canRead) return <Alert><AlertDescription>Current full clinical access is required to review this round.</AlertDescription></Alert>;
  if (!props.patientId || !admissionId) return <Alert><AlertTitle>Select an admission</AlertTitle><AlertDescription>Choose the admission's visit in Chronicle before opening a ward round. All history and outpatient visits have no admission selected.</AlertDescription></Alert>;
  return <ScopedRoundWorkspace key={`${access.scope}:${props.patientId}:${admissionId}`} {...props} admissionId={admissionId} access={access} />;
}
