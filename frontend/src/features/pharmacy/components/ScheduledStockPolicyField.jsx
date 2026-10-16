import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ScheduledStockPolicyField({ form, onChange, error, disabled = false }) {
  if (!form.inventory_item_id || form.frequency?.trim().toLowerCase() === 'prn') return null;
  return <div className="flex flex-col gap-2 rounded-xl border p-4"><Label htmlFor="scheduled-stock-units">Stock units for one scheduled dose ({form.inventory_item_unit || 'choose stock unit'})</Label><Input id="scheduled-stock-units" type="number" min="1" step="1" inputMode="numeric" value={form.scheduled_stock_units_per_dose} onChange={(event) => onChange('scheduled_stock_units_per_dose', event.target.value)} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? 'scheduled-stock-units-error' : 'scheduled-stock-units-help'} /><p id="scheduled-stock-units-help" className="text-xs text-muted-foreground">Use whole base units of this exact catalog item. Clinical dosage is recorded separately. No conversion from dose text, strength or pack size is inferred.</p>{error && <p id="scheduled-stock-units-error" role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}
