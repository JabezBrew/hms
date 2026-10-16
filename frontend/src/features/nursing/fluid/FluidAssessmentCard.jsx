import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { userHasCapability } from '@/shared/lib/access';
import { useFluidAssessment } from './hooks';
const labels = { low_intake: 'Intake below target', high_output: 'Output above threshold', negative_balance: 'Negative balance threshold crossed', positive_balance: 'Positive balance threshold crossed' };
export function FluidAssessmentCard({ admissionId, date, enabled }) {
  const query = useFluidAssessment({ admission_case_id: admissionId, date }, enabled); const { user } = useAuth();
  if (!admissionId) return <p className="text-sm text-muted-foreground">Choose an admission to review fluid monitoring.</p>;
  return <section aria-label="Fluid monitoring" className="grid gap-3 rounded-xl border bg-muted/20 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-medium">Fluid monitoring · {date} UTC</h3>{userHasCapability(user, 'admin.authority.manage') && <Button asChild variant="link" size="sm"><Link to="/settings/fluid-monitoring">Facility rules</Link></Button>}</div>
    {query.isError ? <p role="alert" className="text-sm text-destructive">Monitoring could not be confirmed. <Button variant="outline" size="sm" onClick={() => query.refetch()}>Refresh monitoring</Button></p> : !query.data ? <p role="status" className="text-sm">Loading monitoring…</p> : <>
      <p className="text-xs text-muted-foreground">{query.data.partial_day ? 'Partial UTC day; recorded volumes so far.' : 'Recorded volumes for this UTC day.'} Facility rule version {query.data.settings.version}. Conditions are calculated from effective entries, separate from nursing alerts.</p>
      {query.data.status === 'unconfigured' ? <p className="text-sm">Facility rules have not been configured. No fluid conditions are raised.</p> : query.data.status === 'disabled' ? <p className="text-sm">Fluid monitoring is disabled in the facility rules.</p> : query.data.status === 'no_data' ? <p className="text-sm">No effective observations on this day. No fluid condition is inferred from missing data.</p> : query.data.conditions.length === 0 ? <p className="text-sm">No configured threshold is crossed by the recorded volumes.</p> : <ul className="grid gap-2">{query.data.conditions.map((condition) => <li key={condition.kind} className={condition.severity === 'critical' ? 'text-sm font-medium text-destructive' : 'text-sm'}>{labels[condition.kind]} · {condition.value_ml} ml (threshold {condition.threshold_ml} ml)</li>)}</ul>}
    </>}
  </section>;
}
