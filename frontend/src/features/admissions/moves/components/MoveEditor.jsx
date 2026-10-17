import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useMoveDestinations } from '../hooks/queries';
import { useMovePreparation } from '../hooks/useMovePreparation';
import { MoveButton as Button } from './MoveButton';
import { PlacementLabels } from './PlacementEvidence';
import { MoveReview } from './MoveReview';
function DestinationPage({ query, selected, setSelected, cursors, setCursors }) {
  if (query.isError) return <p role="alert">Eligible destinations could not be confirmed. No cached destination can be selected.</p>;
  if (!query.isFetchedAfterMount || query.isFetching) return <p role="status">Confirming eligible beds…</p>;
  return <><fieldset className="flex min-w-0 flex-col gap-2"><legend className="mb-2 font-medium">Choose an explicit destination</legend>{query.data?.rows.length ? query.data.rows.map(row => <label key={row.bed_id} className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-3"><input type="radio" name="move-destination" className="mt-1 shrink-0" checked={selected?.bed_id === row.bed_id} onChange={() => setSelected(row)} /><PlacementLabels labels={row} /></label>) : <p className="text-sm">No eligible beds on this page match the current scope and search.</p>}</fieldset><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={cursors.length < 2} onClick={() => { setCursors(old => old.slice(0, -1)); setSelected(null); }}>Previous destination page</Button><Button type="button" variant="outline" disabled={!query.data?.hasNext} onClick={() => { setCursors(old => [...old, query.data.cursor]); setSelected(null); }}>Next destination page</Button></div><p className="text-xs text-muted-foreground">Only this bounded page is shown. No bed is chosen automatically; availability is checked again when the move is recorded.</p></>;
}
function canConfirmReview(access, current, review) {
  return access.canWrite && current.can_move && current.placement_token === review.source.placement_token && current.task_membership_token === review.source.task_membership_token;
}
function canPrepareReview(preparing, selected, reason, access, controller, current, query) {
  return !preparing && Boolean(selected) && Boolean(reason.trim()) && access.canWrite && !controller.locked && current.can_move && !query.isFetching;
}
export function MoveEditor({ scope, access, current, refresh, controller, draft, onDenied, open }) {
  const { selected, setSelected, reason, setReason, review, setReview } = draft;
  const [search, setSearch] = useState(''), [appliedSearch, setAppliedSearch] = useState(''), [cursors, setCursors] = useState([null]);
  const cursor = cursors.at(-1), query = useMoveDestinations(scope, access.scope, current.placement_token, { limit: 25, ...(appliedSearch ? { search: appliedSearch } : {}), ...(cursor ? { cursor } : {}) }, open && current.can_move && !controller.locked);
  const { preparing, error, prepare } = useMovePreparation({ scope, access, current, refresh, controller, selected, reason, review, setReview, query, onDenied });
  if (review) return <MoveReview key={review.payload.client_request_id} command={review} allowed={canConfirmReview(access, current, review)} {...{ controller }} onBack={() => { controller.reset(); setReview(null); }} />;
  return <section className="flex min-w-0 flex-col gap-4" aria-label="Plan admission move">
    <div className="flex flex-col gap-2"><Label htmlFor="move-search">Find an eligible ward or bed</Label><div className="flex flex-wrap gap-2"><Input id="move-search" value={search} maxLength={80} className="min-w-0 flex-1" onChange={event => setSearch(event.target.value)} /><Button type="button" variant="outline" onClick={() => { setAppliedSearch(search.trim()); setCursors([null]); setSelected(null); }}>Search eligible beds</Button></div></div>
    <DestinationPage {...{ query, selected, setSelected, cursors, setCursors }} />
    <div className="space-y-2"><Label htmlFor="move-reason">Reason for the move</Label><Textarea id="move-reason" value={reason} maxLength={1000} rows={3} onChange={event => setReason(event.target.value)} /><p className="text-xs text-muted-foreground">Required; 1 to 1,000 characters. Nothing is saved automatically.</p></div>
    {selected && <p className="text-sm">Selected destination: <PlacementLabels labels={selected} /></p>}
    {(error || controller.error) && <p role="alert" className="text-sm text-destructive">{error || controller.error}</p>}
    <Button type="button" disabled={!canPrepareReview(preparing, selected, reason, access, controller, current, query)} onClick={prepare}>{preparing ? 'Checking current placement…' : 'Review move and task routing'}</Button>
  </section>;
}
