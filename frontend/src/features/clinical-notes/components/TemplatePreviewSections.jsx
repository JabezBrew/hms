import { useState } from 'react';
import { CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function PreviewModeFields({ mode, sections, choices, disabled, onModeChange, onSectionsChange }) {
  const selected = new Set(sections);
  return <><div className="flex flex-col gap-2"><Label htmlFor="template-preview-mode">Apply to</Label><Select value={mode} disabled={disabled} onValueChange={onModeChange}><SelectTrigger id="template-preview-mode"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="empty_only">Empty sections only</SelectItem><SelectItem value="all">All generated sections</SelectItem><SelectItem value="selected">Selected sections</SelectItem></SelectGroup></SelectContent></Select></div>
    {mode === 'selected' && <fieldset className="flex flex-col gap-3"><legend className="mb-2 text-sm font-medium">Sections to replace</legend>{choices.map((item) => <div key={item.id} className="flex items-start gap-3"><Checkbox id={`preview-section-${item.id}`} checked={selected.has(item.id)} disabled={disabled} onCheckedChange={(value) => onSectionsChange(value === true ? [...sections, item.id] : sections.filter((key) => key !== item.id))} /><Label htmlFor={`preview-section-${item.id}`}>{item.label}</Label></div>)}</fieldset>}
    {mode !== 'empty_only' && <Alert><AlertDescription>This mode replaces the complete generated section values, including text already entered in those sections. Other sections remain unchanged. Review the exact proposed patch before applying it.</AlertDescription></Alert>}</>;
}
export function DraftResetReview({ disabled, onReset }) {
  const [confirmed, onConfirm] = useState(false);
  return <section className="flex flex-col gap-3 rounded-lg border p-4"><p className="text-sm text-muted-foreground">Existing note content is preserved. If it belongs to a different template or cannot be merged, you can explicitly start an empty draft for this revision.</p><div className="flex items-start gap-3"><Checkbox id="template-empty-confirmed" checked={confirmed} disabled={disabled} onCheckedChange={(value) => onConfirm(value === true)} /><Label htmlFor="template-empty-confirmed">Discard all entered note content and start empty for this selected revision.</Label></div><Button type="button" variant="outline" disabled={disabled || !confirmed} onClick={onReset}>Start empty template draft</Button></section>;
}
export function PreviewPatchEvidence({ result, mode, confirmed, disabled, onConfirm }) {
  return <section aria-label="Proposed template patch" className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"><p className="text-sm">{result.rendered_on} · UTC date · {result.applied_sections.length} section{result.applied_sections.length === 1 ? '' : 's'} generated</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">{typeof result.patch === 'string' ? result.patch : JSON.stringify(result.patch, null, 2)}</pre>{(result.unresolved.length > 0 || result.unresolved_truncated) && <Alert><AlertDescription>Some placeholders remain unresolved. Complete them manually before saving.{result.unresolved.map((item) => <span key={item.name} className="block">{item.name}: {item.count}</span>)}{result.unresolved_truncated && <span className="block">Additional unresolved placeholders are not listed.</span>}</AlertDescription></Alert>}<div className="flex items-start gap-3"><Checkbox id="template-preview-confirmed" checked={confirmed} disabled={disabled} onCheckedChange={(value) => onConfirm(value === true)} /><Label htmlFor="template-preview-confirmed">{mode === 'empty_only' ? 'I reviewed this patient and the generated text to apply to empty sections.' : 'I reviewed this patient and explicitly confirm replacing the generated sections shown above.'}</Label></div></section>;
}

export function PreviewGenerateAction({ disabled, pending, onGenerate }) {
  return <Button type="button" variant="outline" disabled={disabled} onClick={onGenerate}>{pending ? 'Generating preview…' : 'Generate patient-aware preview'}</Button>;
}
export function PreviewReviewedResult({ result, mode, disabled, onApply, children }) {
  const [confirmed, onConfirm] = useState(false);
  return <><CardContent><PreviewPatchEvidence {...{ result, mode, confirmed, disabled, onConfirm }} /></CardContent><CardFooter className="flex flex-wrap gap-2 border-t pt-4">{children}<Button type="button" disabled={disabled || !confirmed || !result.applied_sections.length} onClick={onApply}>Apply reviewed preview to local draft</Button></CardFooter></>;
}
