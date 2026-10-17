import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { validId } from '../model';

export function SourceChoices({ mode, visitChoice, setMode, setVisitChoice, locked, allHistory, selectedEncounter, source }) {
  const visitAvailable = !allHistory && validId(selectedEncounter?.visit_id);
  return <>
    <fieldset className="flex flex-col gap-3"><legend className="mb-2 font-medium">Choose how to start this consultation</legend>
      <RadioGroup value={mode} onValueChange={value => { setMode(value); setVisitChoice(''); }} disabled={locked} aria-label="Consultation source">
        <div className="flex items-start gap-3 rounded-lg border p-3"><RadioGroupItem value="new_outpatient" id="consultation-new-outpatient" /><Label htmlFor="consultation-new-outpatient">Create a new outpatient encounter</Label></div>
        <div className="flex items-start gap-3 rounded-lg border p-3"><RadioGroupItem value="existing_admission_encounter" id="consultation-admission-encounter" /><Label htmlFor="consultation-admission-encounter">Use the exact selected admission encounter</Label></div>
      </RadioGroup>
    </fieldset>
    {mode === 'new_outpatient' && <fieldset className="flex flex-col gap-3"><legend className="mb-2 font-medium">Visit choice</legend><RadioGroup value={visitChoice} onValueChange={setVisitChoice} disabled={locked} aria-label="Consultation visit choice"><div className="flex items-start gap-3"><RadioGroupItem value="no_visit" id="consultation-no-visit" /><Label htmlFor="consultation-no-visit">Start without a visit. No visit or check-in is created.</Label></div><div className="flex items-start gap-3"><RadioGroupItem value="existing_visit" id="consultation-existing-visit" disabled={!visitAvailable} /><Label htmlFor="consultation-existing-visit">Use the actual visit associated with the selected encounter</Label></div></RadioGroup>{!visitAvailable && <p className="text-sm text-muted-foreground">Choose an exact encounter with a recorded visit to use that option. No active or latest visit is substituted.</p>}</fieldset>}
    {mode === 'existing_admission_encounter' && !source && <p role="status">Choose an exact encounter with a single recorded admission association in Chronicle. All history or an ambiguous association cannot choose an admission automatically.</p>}
  </>;
}
