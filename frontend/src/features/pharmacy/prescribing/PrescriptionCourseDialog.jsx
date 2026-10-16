import { emptyScheduledStockForm } from './scheduledStockPolicy';
import { useContext, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { getV2ClientScopeKey } from '@/lib/api/v2/client';
import { createKeyFactory } from '@/shared/lib/queryKeys';
import { userHasCapability } from '@/shared/lib/access';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageState } from '@/shared/components/page/PageState';
import { PrescriptionPatientContext } from './prescriptionPatientContext';
import { courseApi } from './courseApi';
import { courseAllowed, coursePayload, documentationAllowed, documentationPayload, emptyCourseDraft, PRESCRIBING_CAPABILITY, prescribingScope, reuseCourseDraft } from './courseModel';
import { emptyPrnPolicyForm } from './prnPolicy';
import { usePrescriptionAction } from './usePrescriptionAction';
import { PrescriptionCourseFields } from './PrescriptionCourseFields';
import { PrescriptionDocumentationFields } from './PrescriptionDocumentationFields';
import { PrescriptionReadView, PrescriptionSavedReceipt } from './PrescriptionReadView';

const keys = createKeyFactory('prescribing-course-detail');
const titles = { view: 'Prescription details', edit: 'Edit prescribing documentation', documentation: 'Edit prescribing documentation', renew: 'Review renewal course', replace: 'Review replacement course' };

function SourceReader({ id, patientId, scope, children }) {
  const query = useQuery({ queryKey: [...keys.all, scope, id, patientId], queryFn: ({ signal }) => courseApi.detail(id, patientId, { signal }), staleTime: 0, gcTime: 0, retry: false, refetchOnMount: 'always' });
  if (query.error?.status === 403) return <PageState fullHeight={false} className="min-h-0 flex-1 overflow-y-auto" variant="error" title="Prescription access denied" description="Your current access does not permit this prescription detail. Full clinical record access is required." />;
  if (query.isError) return <PageState fullHeight={false} className="min-h-0 flex-1 overflow-y-auto" variant="error" title="Prescription unavailable" description="The current prescription could not be confirmed. Refresh before continuing." action={() => query.refetch()} />;
  if (!query.isFetchedAfterMount || !query.data) return <PageState fullHeight={false} className="min-h-0 flex-1 overflow-y-auto" variant="loading" title="Loading current prescription" />;
  return children(query.data);
}
function Review({ payload, patient, documentation }) {
  return <section aria-label="Reviewed prescription change" className="flex flex-col gap-3 rounded-xl border p-4"><h3 className="font-medium">Review before saving</h3><p>{patient.name} · {patient.code || 'Patient identifier unavailable'}</p>{!documentation && <><p>{payload.medication_name} · {payload.dose} · {payload.route} · {payload.frequency}</p><p>Start {payload.start_date} · {payload.duration_days ? `${payload.duration_days} days` : 'No fixed duration'}</p>{payload.first_dose_at && <p>First dose time {payload.first_dose_at} (UTC)</p>}<p>New-course reason: {payload.change_reason}</p><p className="text-sm">{payload.inventory_item_id ? `Selected stock basis: ${payload.medication_name} · ${payload.expected_stock_unit}` : 'No stock item linked to this new course.'}</p>{payload.scheduled_stock_policy && <p>Each scheduled dose uses {payload.scheduled_stock_policy.stock_units_per_dose} {payload.scheduled_stock_policy.expected_stock_unit} of the selected stock.</p>}<p className="text-sm text-muted-foreground">{payload.relation === 'replacement' ? 'Saving stops the source and creates this new course atomically.' : 'Saving creates this new course and keeps the source terminal.'} It does not schedule doses, reserve stock or move stock.</p>{payload.prn_policy && <p>Reviewed limits: at least {payload.prn_policy.minimum_interval_hours} hours; at most {payload.prn_policy.maximum_doses_per_24_hours} doses in any 24 hours; {payload.prn_policy.stock_units_per_dose} {payload.expected_stock_unit} per dose, for {payload.prn_policy.indication}.</p>}</>}<p className="whitespace-pre-wrap break-words">Instructions: {payload.instructions || 'None recorded'}</p><p className="whitespace-pre-wrap break-words">Prescribing reason: {payload.reason || 'None recorded'}</p></section>;
}
function ActionForm({ source: currentSource, action, patient, controller, onReviewSuccessor }) {
  const [source] = useState(currentSource);
  const documentation = ['edit', 'documentation'].includes(action); const relation = action === 'renew' ? 'renewal' : 'replacement';
  const [form, setForm] = useState(() => documentation ? { instructions: source.instructions, reason: source.reason } : emptyCourseDraft());
  const [checked, setChecked] = useState(null); const [confirmed, setConfirmed] = useState(false); const [error, setError] = useState(null);
  const locked = controller.busy || controller.unknown || Boolean(controller.saved); const allowed = documentation ? documentationAllowed(source) : courseAllowed(source, relation);
  const change = (key, value) => { if (locked) return; setForm((old) => ({ ...old, [key]: value, ...(key === 'medication_name' ? { inventory_item_id: null, inventory_item_name: '', inventory_item_unit: '', inventory_item_controlled: false, ...emptyPrnPolicyForm(), ...emptyScheduledStockForm() } : {}) })); setChecked(null); setConfirmed(false); setError(null); };
  const stock = (item) => { if (locked) return; setForm((old) => ({ ...old, inventory_item_id: item?.id || null, inventory_item_name: item ? `${item.code} · ${item.name}` : '', inventory_item_unit: item?.unit || '', inventory_item_controlled: Boolean(item?.controlled), ...(item ? { medication_name: item.name } : {}), ...(item?.id !== old.inventory_item_id || item?.unit !== old.inventory_item_unit ? { dose: '', ...emptyPrnPolicyForm(), ...emptyScheduledStockForm() } : {}) })); setChecked(null); setConfirmed(false); };
  const review = () => { if (locked) return; try { setChecked(documentation ? documentationPayload(form, source, crypto.randomUUID()) : coursePayload(form, source, relation, crypto.randomUUID())); setConfirmed(false); setError(null); } catch (failure) { setError(failure.message); } };
  if (action === 'view') return <div className="min-h-0 flex-1 space-y-4 overflow-y-auto"><PrescriptionReadView source={source} />{source.successor_prescription_id && <Button type="button" variant="outline" onClick={() => onReviewSuccessor(source.successor_prescription_id)}>Review saved successor</Button>}</div>;
  if (!allowed && !controller.saved && !controller.unknown) return <div className="min-h-0 flex-1 space-y-4 overflow-y-auto"><PrescriptionReadView source={source} />{source.successor_prescription_id && <Button type="button" variant="outline" onClick={() => onReviewSuccessor(source.successor_prescription_id)}>Review saved successor</Button>}<Alert><AlertDescription>{documentation ? 'Documentation is locked for terminal, scheduled or as-needed courses. Use a fully reviewed new course when treatment must change.' : source.successor_prescription_id ? 'A successor is already recorded for this prescription. Review its current saved details before making another decision.' : 'This source status cannot be used for this action. Renewal requires a terminal source; replacement requires an active or held source.'}</AlertDescription></Alert></div>;
  return <><div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto pr-1"><PrescriptionReadView source={source} title="Reviewed source prescription" />
    {controller.saved ? <PrescriptionSavedReceipt receipt={controller.saved} documentation={documentation} refreshFailed={controller.refreshFailed} /> : <>
      {!documentation && !checked && !controller.unknown && <div className="flex flex-col gap-2"><Button type="button" variant="outline" disabled={locked} onClick={() => { setForm(reuseCourseDraft(source)); setConfirmed(false); setError(null); }}>Use current regimen as a draft</Button><p className="text-sm text-muted-foreground">Reusing the source leaves the new start date, first dose time and change reason blank. Choose any stock item again to confirm its current unit, then review every proposed field.</p></div>}
      {controller.unknown ? <Review payload={controller.frozen.payload} patient={patient} documentation={documentation} /> : documentation ? <PrescriptionDocumentationFields form={form} onChange={change} disabled={locked || Boolean(checked)} prefix="documentation" /> : <PrescriptionCourseFields source={source} form={form} onChange={change} onStock={stock} disabled={locked || Boolean(checked)} />}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {controller.error && <Alert variant="destructive"><AlertDescription>{controller.error}</AlertDescription></Alert>}
      {checked && !controller.unknown && <><Review payload={checked} patient={patient} documentation={documentation} /><div className="flex items-start gap-3"><Checkbox id="confirm-prescribing-review" checked={confirmed} disabled={controller.busy} onCheckedChange={(value) => setConfirmed(value === true)} /><Label htmlFor="confirm-prescribing-review" className="leading-relaxed">I confirmed this patient and reviewed the complete {documentation ? 'documentation change' : 'new regimen, stock basis and linked-course limits'}.</Label></div></>}
    </>}
  </div>{!controller.saved && <div className="flex shrink-0 flex-wrap gap-3 border-t pt-4">{controller.unknown ? <><Button type="button" variant="outline" disabled={controller.busy} onClick={() => controller.run({ recover: true })}>Check original saved result</Button><Button type="button" disabled={controller.busy} onClick={() => controller.run()}>Retry exact prescription change</Button></> : checked ? <><Button key="edit-reviewed" type="button" variant="outline" disabled={controller.busy} onClick={() => { setChecked(null); setConfirmed(false); }}>Edit review</Button><Button key="save-reviewed" type="button" disabled={!confirmed || controller.busy} onClick={() => controller.run({ source, payload: checked })}>{controller.busy ? 'Saving…' : documentation ? 'Save reviewed documentation' : 'Create reviewed new course'}</Button></> : <Button key="review-prescription" type="button" disabled={controller.busy} onClick={review}>Review prescription change</Button>}</div>}</>;
}
function Workspace({ open, onOpenChange, id, patient, action, scope, onSuccess }) {
  const controller = usePrescriptionAction(['edit', 'documentation'].includes(action) ? 'documentation' : 'course', patient.id, onSuccess);
  const [generation, setGeneration] = useState(0);
  const [reviewId, setReviewId] = useState(id);
  const close = (next) => { if (!next && !controller.busy) onOpenChange(false); };
  return <Dialog open={open} onOpenChange={close}><DialogContent className="flex max-h-[90dvh] min-w-0 flex-col overflow-hidden sm:max-w-2xl" onEscapeKeyDown={(event) => { if (controller.busy) event.preventDefault(); }} onInteractOutside={(event) => { if (controller.busy) event.preventDefault(); }}><DialogHeader><DialogTitle>{titles[action] || titles.view}</DialogTitle><DialogDescription>{patient.name} · {patient.code || 'Patient identifier unavailable'}</DialogDescription></DialogHeader>
    {open && <SourceReader key={`${generation}:${reviewId}`} id={reviewId} patientId={patient.id} scope={scope}>{(source) => <ActionForm key={reviewId} source={source} patient={patient} action={reviewId === id ? action : 'view'} controller={controller} onReviewSuccessor={setReviewId} />}</SourceReader>}
    <DialogFooter className="shrink-0 border-t pt-4"><Button type="button" variant="ghost" disabled={controller.busy || controller.unknown || Boolean(controller.saved)} onClick={() => { setReviewId(id); setGeneration((old) => old + 1); }}>Reload source and discard draft</Button><Button type="button" variant="outline" disabled={controller.busy} onClick={() => close(false)}>Close</Button></DialogFooter>
  </DialogContent></Dialog>;
}
export function PrescriptionCourseDialog(props) {
  const { user } = useAuth(); const contextualPatient = useContext(PrescriptionPatientContext); const patient = props.patient || contextualPatient;
  const manage = userHasCapability(user, PRESCRIBING_CAPABILITY); const view = manage || userHasCapability(user, 'clinical_documentation.view');
  const context = user?.accessContext; const allowed = view && (props.action === 'view' || manage) && patient?.id && Array.isArray(context?.features) && context.features.includes('encounters') && Array.isArray(context?.patient_visibility) && context.patient_visibility.includes('full_clinical');
  const scope = prescribingScope(user, getV2ClientScopeKey());
  if (!allowed) return <Dialog open={props.open} onOpenChange={props.onOpenChange}><DialogContent><DialogHeader><DialogTitle>Prescribing unavailable</DialogTitle><DialogDescription>Open this prescription from the authorized patient’s Chronicle with the required clinical access.</DialogDescription></DialogHeader><Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>Close</Button></DialogContent></Dialog>;
  return <Workspace key={JSON.stringify([scope, patient.id, props.prescription.id, props.action])} {...props} id={props.prescription.id} patient={patient} scope={scope} />;
}
