import { useId, useRef, useState } from 'react';
import { useClaims, useCreateNhisClaimBatch } from '@/features/billing/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BillingPagination } from './BillingPagination';

function money(amountMinor, currency) {
  if (!Number.isSafeInteger(amountMinor)) return 'Amount unavailable';
  try {
    return new Intl.NumberFormat('en-GH', { style: 'currency', currency }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency || ''}`.trim();
  }
}

export function NhisBatchCreateDialog({ onClose }) {
  const id = useId();
  const [filters, setFilters] = useState({ page: 1, status: 'draft', search: '' });
  const [selection, setSelection] = useState({ scope: '', ids: [] });
  const submitting = useRef(false);
  const search = useDebounce(filters.search, 250);
  const claimsQuery = useClaims({ page: filters.page, page_size: 25, status: filters.status, ...(search ? { search } : {}) });
  const create = useCreateNhisClaimBatch();
  const claims = claimsQuery.data?.results || [];
  const page = claimsQuery.data?.page || filters.page;
  // Scope selection to the actual loaded cursor page, including row identity.
  // Changing filters or a cursor fallback cannot retain invisible selections.
  const selectionScope = JSON.stringify([filters.page, page, filters.status, search, claims.map((claim) => claim.id)]);
  const eligible = claims.filter((claim) => ['draft', 'ready'].includes(claim.status) && Number.isSafeInteger(claim.amount_minor) && claim.amount_minor >= 0);
  const selected = selection.scope === selectionScope ? eligible.filter((claim) => selection.ids.includes(claim.id)) : [];
  const currencies = new Set(selected.map((claim) => claim.currency));
  const total = selected.reduce((sum, claim) => sum + claim.amount_minor, 0);
  const unconfirmed = create.error?.code === 'nhis_batch_unconfirmed';
  const changingSearch = search !== filters.search;
  const locked = create.isPending || unconfirmed || Boolean(create.data);
  const valid = selected.length > 0 && selected.length <= 100 && currencies.size === 1 && Number.isSafeInteger(total);
  const disabled = locked || claimsQuery.isFetching || Boolean(claimsQuery.error) || changingSearch;
  const updateFilters = (patch) => { setSelection({ scope: '', ids: [] }); setFilters((current) => ({ ...current, ...patch })); };
  const changePage = (nextPage) => updateFilters({ page: nextPage });
  const toggle = (claimId, checked) => setSelection({ scope: selectionScope, ids: checked
    ? [...new Set([...selected.map((claim) => claim.id), claimId])].slice(0, 100)
    : selected.filter((claim) => claim.id !== claimId).map((claim) => claim.id) });
  const close = () => { if (!create.isPending) onClose(); };
  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current || disabled || !valid) return;
    submitting.current = true;
    try {
      await create.mutateAsync({ claim_ids: selected.map((claim) => claim.id) });
    } catch {
      // Show the safe definite/unknown outcome inline; never create on retry.
    } finally {
      submitting.current = false;
    }
  };

  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Create NHIS batch</DialogTitle>
        <DialogDescription>Select claims from the current page. Only unbatched draft or ready claims of one currency can be saved; eligibility is checked again when you create the batch. This creates a draft batch for review.</DialogDescription>
      </DialogHeader>
      {create.data ? <>
        <Alert role="status"><AlertTitle>Batch saved</AlertTitle><AlertDescription>
          <p>{create.data.batch_number}</p>
          <p>{create.data.claim_count} claims · {money(create.data.total_amount_minor, create.data.currency)}</p>
          <p>Status: {create.data.status}. The batch has not been submitted to NHIS.</p>
        </AlertDescription></Alert>
        <DialogFooter><Button type="button" onClick={close}>Done</Button></DialogFooter>
      </> : <form onSubmit={submit} className="grid gap-4">
        <fieldset disabled={locked} className="grid gap-4">
          <legend className="sr-only">Claims for the new batch</legend>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <div className="grid gap-2"><Label htmlFor={`${id}-search`}>Find claims</Label><Input id={`${id}-search`} placeholder="Search claim or invoice" value={filters.search} onChange={(event) => updateFilters({ search: event.target.value, page: 1 })} /></div>
            <div className="grid gap-2"><Label htmlFor={`${id}-status`}>Claim status</Label><Select value={filters.status} onValueChange={(status) => updateFilters({ status, page: 1 })} disabled={locked}>
              <SelectTrigger id={`${id}-status`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="ready">Ready</SelectItem></SelectContent>
            </Select></div>
          </div>
          {claimsQuery.error ? <Alert variant="destructive"><AlertDescription>Claims could not be refreshed. <Button type="button" variant="outline" size="sm" onClick={() => claimsQuery.refetch()}>Retry claims</Button></AlertDescription></Alert> : null}
          <Table>
            <TableCaption>Selection applies to this page only. Changing the page or filters clears it.</TableCaption>
            <TableHeader><TableRow>
              <TableHead><Checkbox aria-label="Select all eligible claims on this page" checked={eligible.length > 0 && selected.length === eligible.length ? true : selected.length ? 'indeterminate' : false} disabled={disabled || eligible.length === 0} onCheckedChange={(checked) => setSelection({ scope: selectionScope, ids: checked ? eligible.slice(0, 100).map((claim) => claim.id) : [] })} /></TableHead>
              <TableHead>Claim</TableHead><TableHead>Patient code</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Claimed amount</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {claims.map((claim) => <TableRow key={claim.id} data-state={selected.some((row) => row.id === claim.id) ? 'selected' : undefined}>
                <TableCell><Checkbox aria-label={`Select claim ${claim.claim_number}`} checked={selected.some((row) => row.id === claim.id)} disabled={disabled || !eligible.includes(claim)} onCheckedChange={(checked) => toggle(claim.id, checked === true)} /></TableCell>
                <TableCell className="font-mono text-xs">{claim.claim_number}</TableCell><TableCell>{claim.patient_code || '—'}</TableCell><TableCell>{claim.status}</TableCell><TableCell className="text-right font-mono">{money(claim.amount_minor, claim.currency)}</TableCell>
              </TableRow>)}
              {!claims.length && <TableRow><TableCell colSpan={5}>{claimsQuery.isLoading || changingSearch ? 'Loading claims…' : 'No matching claims on this page.'}</TableCell></TableRow>}
            </TableBody>
          </Table>
          <BillingPagination data={claimsQuery.data} itemLabel="claims" onPageChange={changePage} page={filters.page} pageSize={25} />
        </fieldset>
        <p className="text-sm" aria-live="polite">{selected.length} selected{selected.length > 0 && currencies.size === 1 ? ` · ${money(total, selected[0].currency)}` : ''}</p>
        {currencies.size > 1 && <p role="alert" className="text-sm text-destructive">Choose claims with the same currency.</p>}
        {create.error && <Alert variant="destructive"><AlertTitle>{unconfirmed ? 'Save status unknown' : 'Batch not saved'}</AlertTitle><AlertDescription>{create.error.message}</AlertDescription></Alert>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={create.isPending} onClick={close}>{unconfirmed ? 'Close and review batches' : 'Cancel'}</Button>
          <Button type="submit" disabled={disabled || !valid}>{create.isPending ? 'Creating…' : 'Create batch'}</Button>
        </DialogFooter>
      </form>}
    </DialogContent>
  </Dialog>;
}
