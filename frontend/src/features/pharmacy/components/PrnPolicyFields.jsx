import { useId } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PRN_INTERVAL_HOURS } from '../prescribing/prnPolicy';

export function PrnPolicyFields({ formData, errors, onFieldChange }) {
  const id = useId();
  const interval = Number(formData.prn_minimum_interval_hours);
  return <fieldset className="space-y-4 rounded-lg border border-border p-4">
    <legend className="px-1 text-sm font-medium">As-needed dose limits</legend>
    <p className="text-sm text-muted-foreground">Specify the ordered limits. Nursing requests one dose at a time, pharmacy supplies it, and the administering clinician records the outcome.</p>
    {errors.inventory_item_id ? <Alert variant="destructive"><AlertDescription>{errors.inventory_item_id}</AlertDescription></Alert> : null}
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={`${id}-interval`}>Minimum hours between doses</Label>
        <Select value={formData.prn_minimum_interval_hours} onValueChange={(value) => onFieldChange('prn_minimum_interval_hours', value)}>
          <SelectTrigger id={`${id}-interval`} aria-invalid={Boolean(errors.prn_minimum_interval_hours)}><SelectValue placeholder="Choose interval" /></SelectTrigger>
          <SelectContent className="z-[200]">{PRN_INTERVAL_HOURS.map((hours) => <SelectItem key={hours} value={String(hours)}>{hours} hours</SelectItem>)}</SelectContent>
        </Select>
        {errors.prn_minimum_interval_hours ? <p role="alert" className="text-xs text-destructive">{errors.prn_minimum_interval_hours}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-maximum`}>Maximum doses in any 24 hours</Label>
        <Input id={`${id}-maximum`} type="number" min="1" max={interval ? Math.floor(24 / interval) : undefined} step="1" inputMode="numeric" value={formData.prn_maximum_doses_per_24_hours} onChange={(event) => onFieldChange('prn_maximum_doses_per_24_hours', event.target.value)} aria-invalid={Boolean(errors.prn_maximum_doses_per_24_hours)} />
        {errors.prn_maximum_doses_per_24_hours ? <p role="alert" className="text-xs text-destructive">{errors.prn_maximum_doses_per_24_hours}</p> : null}
      </div>
    </div>
    <div className="space-y-2">
      <Label htmlFor={`${id}-indication`}>Ordered indication</Label>
      <Textarea id={`${id}-indication`} value={formData.prn_indication} onChange={(event) => onFieldChange('prn_indication', event.target.value)} aria-invalid={Boolean(errors.prn_indication)} />
      {errors.prn_indication ? <p role="alert" className="text-xs text-destructive">{errors.prn_indication}</p> : null}
    </div>
    <div className="space-y-2">
      <Label htmlFor={`${id}-stock`}>Stock units used for one dose{formData.inventory_item_unit ? ` (${formData.inventory_item_unit})` : ''}</Label>
      <Input id={`${id}-stock`} type="number" min="1" step="1" inputMode="numeric" value={formData.prn_stock_units_per_dose} onChange={(event) => onFieldChange('prn_stock_units_per_dose', event.target.value)} aria-invalid={Boolean(errors.prn_stock_units_per_dose)} />
      <p className="text-xs text-muted-foreground">Use the selected catalog item's stock unit. The clinical dosage above remains the administration instruction.</p>
      {errors.prn_stock_units_per_dose ? <p role="alert" className="text-xs text-destructive">{errors.prn_stock_units_per_dose}</p> : null}
    </div>
  </fieldset>;
}
