import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { NOTE_TYPES, amendmentPayload, notePayload, templateSections } from '../model';
import { NoteBodyEditor } from './NoteBodyEditor';
import { NoteEvidence } from './NoteEvidence';
import { TemplatePreview } from './TemplatePreview';
import { TemplatePicker } from './TemplatePicker';

export function NoteForm({ patient, encounterId, scope, controller, canWrite, draft, previewOnly = false, canPreviewTemplates = false, onPreviewDenied }) {
  const { source, form, setForm, revision, setRevision, templatesOpen, setTemplatesOpen, reason, setReason, review, confirmed, setConfirmed, error, setError } = draft;
  const locked = controller.busy || controller.unknown || Boolean(controller.saved) || (!canWrite && !previewOnly);
  const change = (key, value) => { if (locked || review) return; setForm((old) => ({ ...old, [key]: value })); setError(null); };
  return <div className="flex flex-col gap-5">
    {source && <NoteEvidence note={source} title="Current recorded source" />}
    {!review && !source && <><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={locked} onClick={() => setTemplatesOpen((value) => !value)}>{templatesOpen ? 'Hide template choices' : 'Choose a template'}</Button>{revision && <Button type="button" variant="outline" disabled={locked} onClick={() => { setRevision(null); }}>Start a freeform note</Button>}</div>{templatesOpen && <TemplatePicker scope={scope} onDenied={onPreviewDenied} onSelect={(selected) => { setRevision(selected); setForm((old) => ({ ...old, title: old.title || selected.title, note_type: selected.note_type })); setTemplatesOpen(false); }} />}{revision && <p className="text-sm text-muted-foreground">Using {revision.title}, revision {revision.version}. Existing text is kept. Preview and explicitly apply generated sections before saving; choosing a different template never clears this draft.</p>}</>}
    {review ? <><NoteEvidence proposed note={{ ...source, ...form, version: source ? source.version + 1 : 1, template_revision: revision }} title="Reviewed note" /><section className="flex flex-col gap-3 rounded-xl border p-4"><p className="font-medium">{patient.name} · {patient.code}</p>{source ? <p className="text-sm">Append version {source.version + 1}. Earlier versions remain unchanged. Reason: {review.payload.reason}</p> : <p className="text-sm">Record this note{encounterId ? ' for the selected encounter' : ' in this patient’s Chronicle'}.</p>}<div className="flex items-start gap-3"><Checkbox id="note-review-confirmed" checked={confirmed} disabled={locked} onCheckedChange={(value) => setConfirmed(value === true)} /><Label htmlFor="note-review-confirmed" className="leading-relaxed">I confirmed this patient and reviewed the complete note.</Label></div></section></> : <>
      {!source && <><div className="flex flex-col gap-2"><Label htmlFor="clinical-note-title">Note title</Label><Input id="clinical-note-title" maxLength={160} value={form.title} disabled={locked} onChange={(event) => change('title', event.target.value)} /></div><div className="flex flex-col gap-2"><Label htmlFor="clinical-note-type">Note type</Label><Select value={form.note_type} disabled={locked || Boolean(revision)} onValueChange={(value) => change('note_type', value)}><SelectTrigger id="clinical-note-type"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{NOTE_TYPES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></div></>}
      <NoteBodyEditor body={form.body} onDenied={onPreviewDenied} disabled={locked} onChange={(value) => change('body', value)} />
      {canPreviewTemplates && revision && !source && <TemplatePreview key={revision.id} {...{ patient, encounterId, revision, scope }} body={form.body} onDenied={onPreviewDenied} disabled={locked} onApply={(body) => setForm((old) => ({ ...old, body }))} onStartEmpty={() => setForm((old) => ({ ...old, body: '' }))} />}
      {templateSections(revision).some((item) => item.type && item.type !== 'text') && <Alert><AlertDescription>These sections record narrative documentation. Use the dedicated clinical panels for measured vital signs, fluid totals or medication administration.</AlertDescription></Alert>}
      {source && <div className="flex flex-col gap-2"><Label htmlFor="note-amendment-reason">Reason for amendment</Label><Textarea id="note-amendment-reason" maxLength={500} value={reason} disabled={locked} onChange={(event) => setReason(event.target.value)} /></div>}
      <p className="text-sm text-muted-foreground">Unsaved text stays only in this workspace. Closing keeps this local draft while your patient and access remain unchanged; refreshing or leaving the Chronicle discards it.</p>
    </>}
    {(error || controller.error) && <Alert variant="destructive"><AlertDescription>{error || controller.error}</AlertDescription></Alert>}
  </div>;
}

export function NoteFormActions({ patient, encounterId, controller, canWrite, draft }) {
  const { source, form, revision, reason, review, setReview, confirmed, setConfirmed, setError } = draft;
  const locked = controller.busy || controller.unknown || Boolean(controller.saved) || !canWrite;
  const prepare = () => { if (locked) return; try { const payload = source ? amendmentPayload(form.body, reason, source, crypto.randomUUID()) : notePayload(form, { requestId: crypto.randomUUID(), revision, encounterId }); setReview({ kind: source ? 'amend' : 'record', payload, source, templateRevision: revision, patientId: patient.id }); setConfirmed(false); setError(null); } catch (failure) { setError(failure.message); } };
  return review ? <><Button key="edit-note-review" type="button" variant="outline" disabled={locked} onClick={() => { setReview(null); setConfirmed(false); }}>Edit review</Button><Button key="save-note-review" type="button" disabled={locked || !confirmed} onClick={() => controller.run(review)}>{controller.busy ? 'Saving…' : source ? 'Save reviewed amendment' : 'Save reviewed note'}</Button></> : <Button key="review-note" type="button" disabled={locked} onClick={prepare}>Review note before saving</Button>;
}
