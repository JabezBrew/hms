import { CONTACT_FIELDS, CONTACT_LABELS } from '../model';
export function RawValue({ value }) {
  const whitespaceOnly = typeof value === 'string' && value.length > 0 && value.trim().length === 0;
  return <><span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{value === null ? 'Not recorded' : value === '' ? 'Blank text' : value}</span>{whitespaceOnly && <span className="ml-2 text-xs text-muted-foreground">Whitespace-only text</span>}</>;
}
export function SupplierValues({ value }) {
  return <dl className="grid min-w-0 grid-cols-1 gap-3 text-sm">
    {['name', ...CONTACT_FIELDS].map(field => <div key={field} className="min-w-0"><dt className="text-muted-foreground">{field === 'name' ? 'Name' : CONTACT_LABELS[field]}</dt><dd className="min-w-0"><RawValue value={value[field]} /></dd></div>)}
    <div className="min-w-0"><dt className="text-muted-foreground">Revision</dt><dd className="font-mono">{value.version}</dd></div>
  </dl>;
}
