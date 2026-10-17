import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { templateSections } from '../model';
import { PreviewModeFields, DraftResetReview, PreviewGenerateAction, PreviewReviewedResult } from './TemplatePreviewSections';
import { useTemplatePreview } from '../hooks/useTemplatePreview';

export function TemplatePreview({ patient, encounterId, revision, body, scope, disabled, onApply, onStartEmpty, onDenied }) {
  const [mode, setMode] = useState('empty_only'); const [sections, setSections] = useState([]); const [chiefComplaint, setChiefComplaint] = useState('');
  const preview = useTemplatePreview({ patientId: patient.id, encounterId, revision, body, scope, enabled: !disabled, onApply, onDenied });
  const choices = templateSections(revision); if (!choices.length) choices.push({ id: 'text', label: 'Note text' });
  const change = (setter, value) => { preview.clear(); setter(value); };
  const result = preview.result?.preview; const blocked = disabled || preview.pending;
  const generate = () => preview.run({ mode, sections: mode === 'selected' ? sections : [], chiefComplaint });
  const generateAction = <PreviewGenerateAction disabled={blocked || (mode === 'selected' && !sections.length)} pending={preview.pending} onGenerate={generate} />;
  return <Card className="min-w-0"><CardHeader><CardTitle>Patient-aware template preview</CardTitle><CardDescription>Uses recorded patient details and the server’s UTC date. Nothing is saved. Review before applying to the local note; preview inputs and results are discarded when this panel closes.</CardDescription></CardHeader><CardContent className="flex min-w-0 flex-col gap-4">
    <p className="text-sm">{revision.title} · exact revision {revision.version}</p><PreviewModeFields {...{ mode, sections, choices }} disabled={blocked} onModeChange={(value) => change(setMode, value)} onSectionsChange={(value) => change(setSections, value)} />
    <div className="flex flex-col gap-2"><Label htmlFor="template-preview-chief">Chief complaint for this preview (optional)</Label><Textarea id="template-preview-chief" maxLength={500} value={chiefComplaint} disabled={blocked} onChange={(event) => change(setChiefComplaint, event.target.value)} /><p className="text-xs text-muted-foreground">Only this supplied complaint is used. Demographic values come from the server; no complaint is inferred from earlier records.</p></div>
    {body.trim() && <DraftResetReview key={hashQueryValue(body)} disabled={blocked} onReset={() => { preview.clear(); onStartEmpty(); }} />}
    {preview.error && <Alert variant="destructive"><AlertDescription>{preview.error}</AlertDescription></Alert>}
  </CardContent>{result ? <PreviewReviewedResult {...{ result, mode, disabled }} onApply={preview.apply}>{generateAction}</PreviewReviewedResult> : <CardFooter className="flex flex-wrap gap-2 border-t pt-4">{generateAction}</CardFooter>}</Card>;
}
