import { parentText } from '../model';
export function RawValue({ value }) {
  return <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{value === null ? 'No description (null)' : value === '' ? 'Empty text' : value}</span>;
}
export function CategoryValues({ value }) {
  return <dl className="grid min-w-0 grid-cols-1 gap-3 text-sm">
    <div className="min-w-0"><dt className="text-muted-foreground">Name</dt><dd><RawValue value={value.name} /></dd></div>
    <div className="min-w-0"><dt className="text-muted-foreground">Description</dt><dd><RawValue value={value.description} /></dd></div>
    <div className="min-w-0"><dt className="text-muted-foreground">Direct parent</dt><dd className="[overflow-wrap:anywhere]">{Object.hasOwn(value, 'parent') ? parentText(value) : value.parent_id === null ? 'No direct parent' : 'Recorded direct parent'}{value.parent_id !== null && <span className="mt-1 block font-mono text-xs">{value.parent_id}</span>}</dd></div>
    <div className="min-w-0"><dt className="text-muted-foreground">Revision</dt><dd className="font-mono">{value.version}</dd></div>
  </dl>;
}
