import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { bodyFields, changeBody } from '../model';

export function NoteBodyEditor({ body, onChange, disabled = false }) {
  const prefix = useId();
  let fields; try { fields = bodyFields(body); } catch (error) { return <p role="alert">{error.message}</p>; }
  if (!fields.length) fields = [{ key: 'text', path: [], label: 'Note', value: '', type: 'string' }];
  return <div className="flex flex-col gap-4">{fields.map((field) => {
    const id = `${prefix}-${field.key}`;
    return <div key={field.key} className="flex flex-col gap-2"><Label htmlFor={id} className="break-words [overflow-wrap:anywhere]">{field.label}</Label>{field.type === 'boolean' ? <Checkbox id={id} checked={field.value} disabled={disabled} onCheckedChange={(value) => onChange(changeBody(body, field, value === true))} /> : field.type === 'number' ? <Input id={id} type="number" value={field.value} disabled={disabled} onChange={(event) => { const number = Number(event.target.value); if (Number.isFinite(number)) onChange(changeBody(body, field, number)); }} /> : <Textarea id={id} rows={fields.length > 1 ? 4 : 10} value={field.value} disabled={disabled} onChange={(event) => onChange(changeBody(body, field, event.target.value))} />}</div>;
  })}</div>;
}
