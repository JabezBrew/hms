import { useEffect, useId, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { getV2ClientScopeKey } from '@/lib/api/v2/client';
import { userHasCapability } from '@/shared/lib/access';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { fluidAccessScope } from './model';
import { useFluidRules, useFluidWrite } from './hooks';
const thresholds = [
  ['min_daily_intake_target', 'Intake target (ml per UTC day)', 0, 10000],
  ['max_daily_output_threshold', 'High output threshold (ml per UTC day)', 0, 20000],
  ['negative_balance_alert_threshold', 'Negative balance threshold (ml)', -10000, 0],
  ['positive_balance_alert_threshold', 'Positive balance threshold (ml)', 0, 10000],
];
function RulesForm({ settings, onReload }) {
  const id = useId(); const [values, setValues] = useState(settings.values); const [reason, setReason] = useState(''); const [key] = useState(() => crypto.randomUUID()); const [review, setReview] = useState(false); const [validation, setValidation] = useState(null); const write = useFluidWrite('updateRules'); const locked = write.busy || write.unknown || Boolean(write.saved) || review;
  const submit = async () => {
    if (write.busy || write.saved) return;
    if (write.unknown) { await write.submit(); return; }
    if (!reason.trim()) { setValidation('Record the clinical or operational reason for changing these facility rules.'); return; }
    const numbers = Object.fromEntries(thresholds.map(([field]) => [field, Number(values[field])]));
    if (thresholds.some(([field, , min, max]) => !Number.isSafeInteger(numbers[field]) || numbers[field] < min || numbers[field] > max)) { setValidation('Use whole millilitre thresholds within the displayed limits.'); return; }
    setValidation(null); if (!review) { setReview(true); return; }
    await write.submit({ client_request_id: key, expected_version: settings.version, reason: reason.trim(), values: { ...values, ...numbers } });
  };
  return <section className="grid max-w-3xl gap-5 rounded-2xl border p-5 sm:p-6"><div><h2 className="font-semibold">{settings.configured ? `Facility rules · version ${settings.version}` : 'Configure facility rules'}</h2><p className="mt-2 text-sm text-muted-foreground">These thresholds apply to every admission in this facility. They assess recorded volumes for each UTC day, including the current partial day. Missing observations raise no fluid condition. Threshold crossings are strict: an equal value does not cross the threshold.</p></div>
    {thresholds.map(([field, label, min, max]) => <div key={field} className="grid gap-2"><Label htmlFor={`${id}-${field}`}>{label}</Label><Input id={`${id}-${field}`} type="number" min={min} max={max} step="1" value={values[field]} disabled={locked} onChange={(e) => setValues({ ...values, [field]: e.target.value })} /><p className="text-xs text-muted-foreground">{min} to {max} ml</p></div>)}
    {[['enable_intake_alerts', 'Assess intake below target'], ['enable_output_alerts', 'Assess output above threshold'], ['enable_balance_alerts', 'Assess negative and positive balance']].map(([field, label]) => <div key={field} className="flex items-center justify-between gap-4"><Label htmlFor={`${id}-${field}`}>{label}</Label><Switch id={`${id}-${field}`} checked={values[field]} disabled={locked} onCheckedChange={(checked) => setValues({ ...values, [field]: checked })} /></div>)}
    <div className="grid gap-2"><Label htmlFor={`${id}-reason`}>Reason for this rule version</Label><Textarea id={`${id}-reason`} maxLength={1000} value={reason} disabled={locked} onChange={(e) => setReason(e.target.value)} /></div>
    {review && !write.saved && <p className="text-sm">Review the thresholds and enabled assessments above. Confirming publishes a new facility rule version and updates ward monitoring immediately. Original observation and rule history remain intact.</p>}
    {(validation || write.error) && <p role="alert" className="text-sm text-destructive">{validation || write.error.message}</p>}{write.error && !write.unknown && <Button type="button" variant="outline" onClick={onReload}>Reload current rules</Button>}{write.saved ? <div className="grid gap-2"><p role="status" className="text-sm font-medium">Facility rule version {write.saved.version} confirmed.</p><Button type="button" variant="outline" onClick={onReload}>Review current rules</Button></div> : <div className="flex flex-wrap gap-3">{review && !write.unknown && <Button type="button" variant="outline" disabled={write.busy} onClick={() => setReview(false)}>Change rules</Button>}<Button type="button" disabled={write.busy} onClick={submit}>{write.busy ? 'Saving…' : write.unknown ? 'Retry exact rule change' : review ? 'Publish reviewed rules' : 'Review rule change'}</Button></div>}
  </section>;
}
function RulesWorkspace() { const query = useFluidRules(); const fresh = query.isFetchedAfterMount && !query.isError && !query.isFetching; const [verified, setVerified] = useState(null);
  // A refresh after a write must not replace an uncertain request or its receipt.
  useEffect(() => { if (!verified && fresh && query.data) setVerified(query.data); }, [verified, fresh, query.data]);
  const reload = async () => { const result = await query.refetch(); if (result.data && !result.isError) setVerified(result.data); };
  return verified ? <RulesForm key={verified.version} settings={verified} onReload={reload} /> : query.isError ? <PageState variant="error" title="Fluid rules unavailable" description="The current facility rules could not be confirmed." action={() => query.refetch()} /> : <PageState variant="loading" title="Loading facility rules" />;
}
export default function FluidRulesPage() { const { user } = useAuth(); const meta = usePageMeta({ title: 'Fluid monitoring rules', breadcrumbs: [{ label: 'Settings', path: '/settings' }, { label: 'Fluid monitoring' }] }); const allowed = userHasCapability(user, 'admin.authority.manage');
  return <PageShell>{meta}<PageHeader title="Fluid monitoring rules" description="Publish reviewed thresholds for this facility's ward monitoring." /><div className="p-4 sm:p-6">{allowed ? <RulesWorkspace key={fluidAccessScope(user, getV2ClientScopeKey())} /> : <PageState variant="denied" title="Facility configuration access required" description="An authorized facility administrator can publish fluid monitoring rules." />}</div></PageShell>;
}
