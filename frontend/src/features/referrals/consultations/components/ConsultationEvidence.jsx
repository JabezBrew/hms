import { Badge } from '@/components/ui/badge';
const time = value => value ? new Date(value).toLocaleString() : 'Not recorded';
export function SourceEvidence({ current }) {
  const selection = current.selection;
  if (!selection) return null;
  return <section className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4" aria-label="Reviewed consultation source">
    <div className="flex min-w-0 flex-col gap-1"><p className="break-words font-medium">{current.patient.display_name}</p><p className="break-words text-xs text-muted-foreground">Patient code {current.patient.patient_code}</p></div>
    <h3 className="font-heading text-base">{selection.source.mode === 'new_outpatient' ? 'Create an outpatient encounter' : 'Use this admission encounter'}</h3>
    {selection.source.mode === 'new_outpatient' ? <p className="text-sm">{selection.source.visit.choice === 'no_visit' ? 'No visit will be created, checked in or selected.' : `Use the explicitly selected ${selection.visit.clinic_name || 'clinic'} visit · ${selection.visit.status.replaceAll('_', ' ')} · checked in ${time(selection.visit.checked_in_at)}.`}</p> : <><p>{selection.admission.ward_name} · {selection.admission.status.replaceAll('_', ' ')}</p><p className="text-sm">Reuse the exact {selection.encounter.encounter_type} encounter, started {time(selection.encounter.started_at)}. Its actual type, visit, admission and placement remain unchanged.</p><p className="text-sm">This does not close the admission or its shared encounter.</p></>}
    {selection.visit?.status === 'on_hold' && <p className="text-sm">This explicitly resumes the held visit into consultation.</p>}
    {selection.visit?.status === 'in_triage' && <p className="text-sm">This visit is currently in triage. Starting consultation changes its visit status; it does not complete a triage assessment.</p>}
    {selection.appointment && <p className="text-sm">Referral appointment: {time(selection.appointment.starts_at)} · {selection.appointment.status.replaceAll('_', ' ')}. The booking remains unchanged.</p>}
    <p className="text-xs text-muted-foreground">The referral remains {current.referral.status}. Notes and the referral response are recorded separately after the start.</p>
  </section>;
}
export function LinkEvidence({ link, title = 'Recorded consultation link' }) {
  if (!link) return <p>No consultation start is currently recorded for this referral.</p>;
  return <section className="flex flex-col gap-3 rounded-lg border p-4" aria-label={title}><div className="flex flex-wrap items-center gap-2"><h3 className="font-heading text-base">{title}</h3><Badge variant="outline">{link.encounter_created ? 'Outpatient encounter created' : 'Admission encounter reused'}</Badge></div><p className="text-sm">Recorded by {link.recorded_by_display_name} · {time(link.recorded_at)}</p><p className="text-sm">Actual encounter type: {link.encounter_type}. It began {time(link.encounter_started_at)} and was {link.encounter_status_at_start.replaceAll('_', ' ')} at the start.</p>{link.admission_case_id && <p className="text-sm">The original admission began {time(link.admission_admitted_at)}. Its encounter, visit and placement were preserved.</p>}<p className="text-xs text-muted-foreground">This is the immutable start evidence. The encounter and referral may have changed since.</p></section>;
}
