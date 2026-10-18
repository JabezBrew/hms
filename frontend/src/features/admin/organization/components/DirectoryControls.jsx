import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UNIT_TYPES } from '../model';
export function DirectoryFilters({ state, onChange, disabled }) {
  return <div className="flex flex-wrap gap-4"><div className="grid min-w-48 gap-2"><Label htmlFor="org-unit-type">Unit type</Label><Select value={state.unit_type || 'all'} onValueChange={value => onChange({ ...state, unit_type: value === 'all' ? '' : value })} disabled={disabled}><SelectTrigger id="org-unit-type"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All types</SelectItem>{Object.entries(UNIT_TYPES).map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></div>
    <div className="grid min-w-48 gap-2"><Label htmlFor="org-unit-status">Status</Label><Select value={state.status} onValueChange={status => onChange({ ...state, status })} disabled={disabled}><SelectTrigger id="org-unit-status"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="all">All statuses</SelectItem></SelectGroup></SelectContent></Select></div></div>;
}
export function DirectoryPagination({ page, hasNext, onPrevious, onNext, busy, label = 'Organization unit pages' }) {
  return <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Page {page + 1} · Up to 25 units</p><div className="flex gap-2"><Button type="button" variant="outline" disabled={busy || page === 0} onClick={onPrevious}>Previous</Button><Button type="button" variant="outline" disabled={busy || !hasNext} onClick={onNext}>Next</Button></div></nav>;
}
