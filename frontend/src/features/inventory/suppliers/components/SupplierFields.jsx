import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CONTACT_FIELDS, CONTACT_LABELS } from '../model';
export function SupplierFields({ create, selection, busy, fields, change }) {
  return <>
    <fieldset disabled={busy} className="grid min-w-0 gap-4"><legend className="mb-2 text-sm font-medium">Supplier identity</legend>
      {create ? <div className="grid min-w-0 gap-2"><Label htmlFor="supplier-code">Permanent supplier code</Label><Input id="supplier-code" value={fields.code} onChange={event => change({ code: event.target.value })} autoComplete="off" /><p className="text-xs text-muted-foreground">Up to 120 characters / 480 UTF-8 bytes. The code remains permanent.</p></div> : <p className="whitespace-pre-wrap font-mono text-sm [overflow-wrap:anywhere]">{selection.supplier.code} · Revision {selection.supplier.version}</p>}
      <div className="grid min-w-0 gap-2"><Label htmlFor="supplier-name">Supplier name</Label><Textarea id="supplier-name" rows={2} value={fields.name} onChange={event => change({ name: event.target.value })} autoComplete="off" /><p className="text-xs text-muted-foreground">New or replaced names use up to 100 characters / 400 UTF-8 bytes. Unchanged historical text is retained exactly.</p></div>
    </fieldset>
    <fieldset disabled={busy} className="grid min-w-0 gap-4"><legend className="mb-2 text-sm font-medium">Contact details and address</legend>
      {CONTACT_FIELDS.map(field => <div key={field} className="grid min-w-0 gap-2"><Label htmlFor={`supplier-${field}-mode`}>{CONTACT_LABELS[field]} value</Label><Select value={fields[`${field}Mode`]} onValueChange={mode => change({ [`${field}Mode`]: mode })}><SelectTrigger id={`supplier-${field}-mode`} className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="null">Not recorded</SelectItem><SelectItem value="text">Enter text</SelectItem></SelectGroup></SelectContent></Select>
        {fields[`${field}Mode`] === 'text' && <><Label htmlFor={`supplier-${field}`}>{CONTACT_LABELS[field]}</Label><Textarea id={`supplier-${field}`} rows={field === 'address' ? 4 : 2} value={fields[field]} onChange={event => change({ [field]: event.target.value })} autoComplete="off" spellCheck={false} /></>}
      </div>)}
      <p className="text-xs text-muted-foreground">Not recorded and blank text are distinct. Existing values remain exact unless you change them. The server checks new email syntax; it does not verify delivery.</p>
    </fieldset>
    {!create && <div className="grid min-w-0 gap-2"><Label htmlFor="supplier-reason">Correction reason</Label><Textarea id="supplier-reason" value={fields.reason} onChange={event => change({ reason: event.target.value })} disabled={busy} /><p className="text-xs text-muted-foreground">Up to 1,000 characters / 4,000 UTF-8 bytes without control characters.</p></div>}
  </>;
}
