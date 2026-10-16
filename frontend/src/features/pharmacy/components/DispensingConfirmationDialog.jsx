import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { userHasCapability } from '@/shared/lib/access';
import { useDispenseMedication } from '@/features/nursing/hooks';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DispensingLocationPicker } from './DispensingLocationPicker';
export function DispensingConfirmationDialog({ medication, unconfirmed, onUnconfirmed, onClose, onBusy }) {
  const { user } = useAuth(); const canDispense = userHasCapability(user, 'pharmacy.dispense');
  const [location, setLocation] = useState(null); const [quantity, setQuantity] = useState(() => Number.isSafeInteger(medication.dose_count) && medication.dose_count > 0 ? String(medication.dose_count) : '');
  const [saved, setSaved] = useState(null); const [error, setError] = useState(null); const [unknown, setUnknown] = useState(Boolean(unconfirmed));
  const active = useRef(false); const mounted = useRef(true); const mutation = useDispenseMedication();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const doses = Number(quantity); const validQuantity = Number.isSafeInteger(doses) && doses > 0 && doses <= medication.dose_count;
  const linked = Boolean(medication.inventory_item_id && medication.inventory_item_name && medication.inventory_item_code && medication.inventory_item_unit);
  const unitsChanged = Boolean(medication.prn_policy?.stock_unit && medication.inventory_item_unit && medication.prn_policy.stock_unit !== medication.inventory_item_unit);
  const stockQuantity = medication.prn_policy ? doses * medication.prn_policy.stock_units_per_dose : null;
  const validStock = stockQuantity === null || (Number.isSafeInteger(stockQuantity) && stockQuantity > 0);
  const locked = mutation.isPending || unknown || Boolean(saved);
  const close = () => { if (!active.current) onClose(); };
  const submit = async () => {
    if (active.current || locked || !canDispense || !location || !linked || unitsChanged || !validQuantity || !validStock) return;
    active.current = true; onBusy?.(true); setError(null);
    try {
      const response = await mutation.mutateAsync({ fulfillmentId: medication.fulfillment_id || medication.id, itemId: medication.inventory_item_id, locationId: location.id, quantity: doses });
      if (mounted.current) setSaved(response.data);
    } catch (value) {
      if (mounted.current) { setError(value); if (value.name === 'PharmacyDispenseUnconfirmedError') { setUnknown(true); onUnconfirmed(medication.id); } }
    } finally { active.current = false; onBusy?.(false); }
  };
  return <Dialog open onOpenChange={(next) => { if (!next) close(); }}><DialogContent className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl">
    <DialogHeader><DialogTitle>Confirm dispensing</DialogTitle><DialogDescription>{medication.patient_name} · {medication.patient_mrn || medication.patient_code || 'Patient identifier unavailable'} · {medication.medication_name} · {medication.dosage || medication.dose} · {medication.route}</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-4 overflow-y-auto pr-1">{saved ? <Alert role="status"><AlertTitle>Supply confirmed</AlertTitle><AlertDescription>{saved.dispensed_dose_count} {saved.dispensed_dose_count === 1 ? 'dose' : 'doses'} supplied · {saved.remaining_dose_count} {saved.remaining_dose_count === 1 ? 'dose' : 'doses'} remaining. The server recorded the stock issue.</AlertDescription></Alert> : <>
      <section className="grid gap-1 rounded-xl border bg-muted/30 p-4" aria-label="Linked stock item"><h3 className="text-sm font-medium">Linked stock item</h3>{linked ? <><p className="text-sm">{medication.inventory_item_name}</p><p className="text-xs text-muted-foreground">{medication.inventory_item_code} · {medication.inventory_item_unit}</p></> : <p role="alert" className="text-sm text-destructive">Linked stock details are unavailable. Refresh the queue before supplying this order.</p>}</section>
      {medication.prn_policy && <p className="text-sm">Each dose uses {medication.prn_policy.stock_units_per_dose} {medication.prn_policy.stock_unit} of linked stock.</p>}
      {unitsChanged && <p role="alert" className="text-sm text-destructive">The catalog unit changed after prescribing. Prescriber review is required before supply.</p>}
      <DispensingLocationPicker value={location} onSelect={setLocation} disabled={locked || !canDispense} />
      <div className="grid gap-2"><Label htmlFor="pharmacy-doses-to-supply">Doses to supply</Label><Input id="pharmacy-doses-to-supply" type="number" min="1" max={medication.dose_count} step="1" value={quantity} disabled={locked || !canDispense} onChange={(event) => setQuantity(event.target.value)} /><p className="text-xs text-muted-foreground">{medication.dose_count} {medication.dose_count === 1 ? 'dose remains' : 'doses remain'} on this request.{stockQuantity !== null && validQuantity && validStock ? ` This supply uses ${stockQuantity} ${medication.prn_policy.stock_unit}.` : ''}</p></div>
      {error && !unknown && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
      {unknown && <Alert variant="destructive"><AlertTitle>Supply status unknown</AlertTitle><AlertDescription>Supply may have been recorded. Close and review the refreshed queue and stock issue history before issuing more stock.</AlertDescription></Alert>}
    </>}</div>
    <DialogFooter><Button type="button" variant="outline" disabled={mutation.isPending} onClick={close}>{saved ? 'Done' : 'Cancel'}</Button>{!saved && <Button type="button" disabled={locked || !canDispense || !linked || Boolean(unitsChanged) || !location || !validQuantity || !validStock} onClick={submit}>{mutation.isPending ? 'Dispensing…' : 'Confirm Dispense'}</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
