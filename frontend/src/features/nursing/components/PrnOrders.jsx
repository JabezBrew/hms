import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { usePrnOrders, useRequestPrnDose } from '../hooks/usePrnOrders';

const REASONS = {
  admission_inactive: 'This admission is no longer active.',
  unconfigured: 'Ask the prescriber to replace this order with explicit PRN limits.',
  stock_changed: 'The stock item or unit has changed. Prescriber review is required.',
  prescription_on_hold: 'This prescription is on hold.',
  pending_dose: 'Review the outstanding dose in the MAR before requesting another.',
  not_started: 'The prescribed start time has not been reached.',
  course_ended: 'The prescribed duration has ended.',
  dose_limit: 'The minimum interval or rolling 24-hour limit has not yet cleared.',
};

function PrnRequestDialog({ order, admissionId, onClose }) {
  const [indication, setIndication] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const busy = useRef(false);
  const mutation = useRequestPrnDose();
  const close = () => { if (!busy.current) onClose(); };
  const submit = async () => {
    if (busy.current || uncertain || !indication.trim()) return;
    busy.current = true;
    try {
      await mutation.mutateAsync({ prescription_id: order.prescription_id, admission_case_id: admissionId, client_request_id: requestId, indication });
      toast.success('Dose requested. Pharmacy must record supply before it can be administered.');
      onClose();
    } catch (error) {
      if (error?.name === 'PrnRequestUnconfirmedError') setUncertain(true);
      toast.error(error?.message || 'The dose request could not be saved.');
    } finally { busy.current = false; }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent>
    <DialogHeader><DialogTitle>Request one as-needed dose</DialogTitle><DialogDescription>{order.medication_name} · {order.dose} · {order.route}</DialogDescription></DialogHeader>
    <p className="text-sm text-muted-foreground">Prescribed indication: {order.prn_policy?.indication}</p>
    <div className="space-y-2"><Label htmlFor="prn-dose-indication">Why is this dose needed now?</Label><Textarea id="prn-dose-indication" value={indication} onChange={(event) => setIndication(event.target.value)} maxLength={500} disabled={mutation.isPending || uncertain} /></div>
    {uncertain && <Alert variant="destructive"><AlertDescription>The request may have been saved. Close this dialog and review the refreshed MAR and outstanding dose. Do not make another request to replace it.</AlertDescription></Alert>}
    <DialogFooter><Button variant="outline" onClick={close} disabled={mutation.isPending}>{uncertain ? 'Close' : 'Cancel'}</Button><Button onClick={submit} disabled={mutation.isPending || uncertain || !indication.trim()}>{mutation.isPending ? 'Requesting…' : 'Request dose'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function PrnOrders({ admissionId }) {
  return <PrnOrdersWorkspace key={admissionId} admissionId={admissionId} />;
}
function PrnOrdersWorkspace({ admissionId }) {
  const query = usePrnOrders(admissionId);
  const [selected, setSelected] = useState(null);
  const orders = query.data?.pages.flatMap((page) => page.items) || [];
  return <Card>
    <CardHeader><CardTitle className="text-base">As-needed medications</CardTitle><CardDescription>Request one indicated dose, arrange pharmacy supply, then record what happened in the MAR. Limits use actual administered doses across the preceding 24 hours.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {selected && <PrnRequestDialog order={selected} admissionId={admissionId} onClose={() => setSelected(null)} />}
      {query.isPending && <p role="status" className="text-sm text-muted-foreground">Loading as-needed orders…</p>}
      {query.isError && <Alert variant="destructive"><AlertDescription>As-needed orders could not be fully refreshed. Request actions are unavailable until the list reloads. <Button variant="link" onClick={() => query.refetch()}>Reload orders</Button></AlertDescription></Alert>}
      {!query.isPending && !query.isError && orders.length === 0 && <p className="text-sm text-muted-foreground">No active as-needed orders for this patient.</p>}
      {orders.map((order) => <div key={order.prescription_id} className="flex flex-col gap-3 border-b border-border pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1"><p className="text-sm font-medium">{order.medication_name}</p><p className="text-sm text-muted-foreground">{order.dose} · {order.route}</p>
          {order.prn_policy && <><p className="text-sm">{order.prn_policy.indication}</p><p className="text-xs text-muted-foreground">At least {order.prn_policy.minimum_interval_hours} hours apart · maximum {order.prn_policy.maximum_doses_per_24_hours} {order.prn_policy.maximum_doses_per_24_hours === 1 ? 'dose' : 'doses'} in 24 hours · {order.prn_policy.stock_units_per_dose} {order.prn_policy.stock_unit} per dose</p><p className="text-xs text-muted-foreground">{order.administered_in_last_24_hours} {order.administered_in_last_24_hours === 1 ? 'dose' : 'doses'} administered in the preceding 24 hours</p></>}
          {order.unavailable_reason && <p className="text-xs text-muted-foreground">{REASONS[order.unavailable_reason] || 'Review this order before requesting a dose.'}</p>}
          {order.pending_medication_administration_id && <p className="text-xs font-medium">{order.pending_is_dispensed ? 'Outstanding dose supplied — record its outcome in the MAR.' : 'Outstanding dose awaiting pharmacy supply.'}</p>}
          {order.next_eligible_at && <p className="text-xs text-muted-foreground">Next eligibility check: {new Date(order.next_eligible_at).toISOString().slice(0,16).replace('T',' ')} UTC</p>}
        </div><Button size="sm" variant="outline" onClick={() => setSelected(order)} disabled={query.isError || query.isFetching || Boolean(order.unavailable_reason) || !order.prn_policy}>Request one dose</Button>
      </div>)}
      {query.hasNextPage && <Button variant="outline" disabled={query.isFetchingNextPage || query.isError} onClick={() => query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading…' : 'Load more as-needed orders'}</Button>}
    </CardContent>
  </Card>;
}
