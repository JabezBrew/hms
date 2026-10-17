import { useState } from 'react';
import { ConsultationButton as Button } from './ConsultationButton';
import { useSelectedConsultationSource } from '../hooks/queries';
import { useStartPreparation } from '../hooks/useStartPreparation';
import { unavailableCopy, validId } from '../model';
import { SourceEvidence } from './ConsultationEvidence';
import { StartReview } from './StartReview';
import { SourceChoices } from './SourceChoices';
import { RestrictedOverride } from './RestrictedOverride';
function sourceFor(mode, visitChoice, encounter, allHistory) {
  if (mode === 'new_outpatient' && visitChoice === 'no_visit') return { mode, visit: { choice: 'no_visit' } };
  if (mode === 'new_outpatient' && visitChoice === 'existing_visit' && validId(encounter?.visit_id) && !allHistory) return { mode, visit: { choice: 'existing_visit', visit_id: encounter.visit_id } };
  const admission = encounter?.admission;
  if (mode === 'existing_admission_encounter' && !allHistory && encounter?.admission_link_ambiguous !== true && validId(encounter?.id) && validId(admission?.admission_id || admission?.id) && admission.encounter_id === encounter.id) return { mode, admission_case_id: admission.admission_id || admission.id, encounter_id: encounter.id };
  return null;
}
export function StartComposer({ scope, access, controller, selectedEncounter, allHistory, onDenied, open, baseContextToken }) {
  const [mode, setMode] = useState(''), [visitChoice, setVisitChoice] = useState(''), [overrideConfirmed, setOverrideConfirmed] = useState(false), [code, setCode] = useState(''), [note, setNote] = useState('');
  const source = sourceFor(mode, visitChoice, selectedEncounter, allHistory);
  const { query, ready, current, allowed } = useSelectedConsultationSource({ scope, access, source, open, onDenied });
  const override = current?.selection?.restricted_override_required && overrideConfirmed ? { reason_code: code, reason_note: note } : null;
  const preparation = useStartPreparation({ scope, access, source, current, baseContextToken, override, controller, onDenied });
  if (preparation.review) return <StartReview key={preparation.review.payload.client_request_id} command={preparation.review} allowed={allowed} controller={controller} onBack={() => preparation.setReview(null)} />;
  return <section className="flex min-w-0 flex-col gap-4" aria-label="Choose consultation source">
    <SourceChoices {...{ mode, visitChoice, setMode, setVisitChoice, allHistory, selectedEncounter, source }} locked={controller.locked} />
    {source && !ready && <p role={query.isError ? 'alert' : 'status'}>{query.isError ? 'This exact source could not be confirmed. Cached source evidence is hidden.' : 'Confirming the selected consultation source…'}</p>}
    {current && <><SourceEvidence current={current} />{!current.can_start && <p role="status">{unavailableCopy[current.unavailable_reason]}</p>}<RestrictedOverride current={current} confirmed={overrideConfirmed} setConfirmed={setOverrideConfirmed} {...{ code, setCode, note, setNote }} /></>}
    {(preparation.error || controller.error) && <p role="alert" className="text-sm text-destructive">{preparation.error || controller.error}</p>}
    <Button type="button" disabled={!allowed || preparation.preparing || controller.locked || (current?.selection?.restricted_override_required && !overrideConfirmed)} onClick={preparation.prepare}>{preparation.preparing ? 'Checking current consultation source…' : 'Review consultation start'}</Button>
    <p className="text-xs text-muted-foreground">No mode or visit is selected automatically. Nothing is saved until the complete start is reviewed and confirmed.</p>
  </section>;
}
