import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LOCATION_TYPES, TEMPERATURE_ZONES } from '../model';
function Filter({ id, label, value, options, onChange, disabled }) {
  return <div className="grid min-w-44 gap-2"><Label htmlFor={id}>{label}</Label><Select value={value || 'all'} onValueChange={next => onChange(next === 'all' ? '' : next)} disabled={disabled}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All {label.toLowerCase()}</SelectItem>{Object.entries(options).map(([key,text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectGroup></SelectContent></Select></div>;
}
export function DirectoryFilters({ state, onChange, disabled }) {
  // This is the unsubmitted search draft. The parent owns only the applied filter.
  const [search, setSearch] = useState(''), [error, setError] = useState(null);
  const submit = event => { event.preventDefault(); const value = search.trim(); if (new TextEncoder().encode(value).length > 160) { setError('Use a search of up to 160 UTF-8 bytes.'); return; } setError(null); onChange({ ...state, search: value }); };
  return <div className="grid gap-4"><form onSubmit={submit} className="flex flex-wrap items-end gap-3"><div className="grid min-w-0 flex-1 gap-2"><Label htmlFor="location-search">Find a location by name or code</Label><Input id="location-search" value={search} onChange={event => setSearch(event.target.value)} disabled={disabled} autoComplete="off" /></div><Button type="submit" variant="outline" disabled={disabled}>Search locations</Button>{error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}</form><div className="flex flex-wrap gap-4"><Filter id="location-filter-type" label="Types" value={state.location_type} options={LOCATION_TYPES} onChange={location_type => onChange({ ...state, location_type })} disabled={disabled} /><Filter id="location-filter-zone" label="Temperature zones" value={state.temperature_zone} options={TEMPERATURE_ZONES} onChange={temperature_zone => onChange({ ...state, temperature_zone })} disabled={disabled} /><Filter id="location-filter-status" label="Statuses" value={state.status} options={{ active: 'Active', inactive: 'Inactive' }} onChange={status => onChange({ ...state, status })} disabled={disabled} /></div></div>;
}
export function DirectoryPagination({ page, hasNext, onPrevious, onNext, busy }) {
  return <nav aria-label="Storage location pages" className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Page {page + 1} · Up to 25 locations</p><div className="flex gap-2"><Button type="button" variant="outline" disabled={busy || page === 0} onClick={onPrevious}>Previous</Button><Button type="button" variant="outline" disabled={busy || !hasNext} onClick={onNext}>Next</Button></div></nav>;
}
