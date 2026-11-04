import { CONTACT_FIELDS, CONTACT_LABELS } from '../model';
import { SupplierValues, RawValue } from './SupplierValues';
export function SupplierReview({ command }) {
  const { input, previous } = command;
  return <div className="grid min-w-0 gap-4 rounded-xl border bg-muted/30 p-4"><h3 className="font-medium">Review exact supplier change</h3>
    {previous && <section className="grid min-w-0 gap-2"><h4 className="font-medium">Current reviewed supplier</h4><p className="whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">{previous.code} · {previous.is_active ? 'Active' : 'Retired'}</p><SupplierValues value={previous} /></section>}
    {['create', 'correct'].includes(input.action) ? <><dl className="grid min-w-0 grid-cols-1 gap-3 text-sm">{input.action === 'create' && <div className="min-w-0"><dt className="text-muted-foreground">Permanent code</dt><dd><RawValue value={input.code} /></dd></div>}
      {['name', ...CONTACT_FIELDS].map(field => <div key={field} className="min-w-0"><dt className="text-muted-foreground">Reviewed {field === 'name' ? 'name' : CONTACT_LABELS[field].toLowerCase()}</dt><dd className="min-w-0"><RawValue value={input[field]} />{previous && input[field] === previous[field] && <span className="ml-2 text-xs text-muted-foreground">Unchanged value</span>}</dd></div>)}
      {input.action === 'correct' && <div className="min-w-0"><dt className="text-muted-foreground">Correction reason</dt><dd><RawValue value={input.reason} /></dd></div>}
    </dl><p className="text-sm">This maintains the supplier record. Item bindings and recorded purchase-order names remain intact.</p></> : <p className="text-sm">{input.action === 'retire' ? 'Stop new supplier selection.' : 'Allow new supplier selection again.'} A retained item reference blocks this unused-only action, including inactive or malformed references. Recorded purchase-order names alone do not establish an item binding.</p>}
  </div>;
}
