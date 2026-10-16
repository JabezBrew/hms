import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MedicationStockPicker } from '../components/MedicationStockPicker';
import { PrnPolicyFields } from '../components/PrnPolicyFields';
import { PrescriptionDocumentationFields } from './PrescriptionDocumentationFields';
import { COURSE_FREQUENCIES, COURSE_ROUTES, FREQUENCY_LABELS, ROUTE_LABELS, isPrnSource } from './courseModel';

export function PrescriptionCourseFields({ source, form, onChange, onStock, disabled }) {
  const prn = isPrnSource(source);
  return <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-5"><legend className="mb-3 font-medium">Review the new regimen</legend>
    <p className="text-sm text-muted-foreground">Enter each new-course decision explicitly. The source prescription remains part of the record.</p>
    <div className="flex flex-col gap-2"><Label htmlFor="new-course-medication">Medication</Label><Input id="new-course-medication" maxLength={160} value={form.medication_name} onChange={(event) => onChange('medication_name', event.target.value)} /></div>
    {!disabled && <MedicationStockPicker itemId={form.inventory_item_id} itemName={form.inventory_item_name} onSelect={onStock} required={prn} />}
    {disabled && form.inventory_item_id && <p className="text-sm">Selected stock: {form.inventory_item_name} · {form.inventory_item_unit}</p>}
    <div className="flex flex-col gap-2"><Label htmlFor="new-course-dose">Dose</Label><Input id="new-course-dose" maxLength={120} value={form.dose} onChange={(event) => onChange('dose', event.target.value)} /></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2"><Label htmlFor="new-course-route">Route</Label><Select value={form.route} onValueChange={(value) => onChange('route', value)} disabled={disabled}><SelectTrigger id="new-course-route"><SelectValue placeholder="Choose route" /></SelectTrigger><SelectContent><SelectGroup>{COURSE_ROUTES.map((route) => <SelectItem key={route} value={route}>{ROUTE_LABELS[route]}</SelectItem>)}</SelectGroup></SelectContent></Select></div>
      <div className="flex flex-col gap-2"><Label htmlFor="new-course-frequency">Frequency</Label><Select value={form.frequency} onValueChange={(value) => onChange('frequency', value)} disabled={disabled}><SelectTrigger id="new-course-frequency"><SelectValue placeholder="Choose frequency" /></SelectTrigger><SelectContent><SelectGroup>{(prn ? ['prn'] : COURSE_FREQUENCIES).map((frequency) => <SelectItem key={frequency} value={frequency}>{FREQUENCY_LABELS[frequency]}</SelectItem>)}</SelectGroup></SelectContent></Select></div>
    </div>
    {prn && <><p className="text-sm text-muted-foreground">Earlier recorded doses and pending doses in linked courses count when checking this course’s reviewed limits, including when medication or stock changes.</p><PrnPolicyFields formData={form} errors={{}} onFieldChange={onChange} /></>}
    <div className="grid gap-4 sm:grid-cols-2"><div className="flex flex-col gap-2"><Label htmlFor="new-course-start">Start date</Label><Input id="new-course-start" type="date" value={form.start_date} onChange={(event) => onChange('start_date', event.target.value)} /></div><div className="flex flex-col gap-2"><Label htmlFor="new-course-duration">Duration in days (optional)</Label><Input id="new-course-duration" type="number" min="1" step="1" value={form.duration_days} onChange={(event) => onChange('duration_days', event.target.value)} /><p className="text-xs text-muted-foreground">Leave blank for no fixed duration.</p></div></div>
    <div className="flex flex-col gap-2"><Label htmlFor="new-course-first-dose">First dose time (UTC, optional)</Label><Input id="new-course-first-dose" type="datetime-local" value={form.first_dose_at} onChange={(event) => onChange('first_dose_at', event.target.value)} /><p className="text-xs text-muted-foreground">Recording a time does not create a nursing schedule.</p></div>
    <PrescriptionDocumentationFields form={form} onChange={onChange} disabled={disabled} />
    <div className="flex flex-col gap-2"><Label htmlFor="new-course-change-reason">Reason for this new course</Label><Textarea id="new-course-change-reason" maxLength={2000} rows={3} value={form.change_reason} onChange={(event) => onChange('change_reason', event.target.value)} /></div>
  </fieldset>;
}
