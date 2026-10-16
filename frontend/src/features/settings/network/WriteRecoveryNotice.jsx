import { useState, useSyncExternalStore } from 'react';
import { currentNetworkPrincipal } from '@/lib/api/v2/networkAccessGuard';
import { acknowledgeWriteReview, getWriteUncertaintySnapshot, subscribeWriteUncertainty } from '@/lib/api/v2/writeUncertainty';
import { Button } from '@/components/ui/button';

const WORKFLOW_LABELS = { admin: 'Access settings', auth: 'Account settings', billing: 'Billing', clinical: 'Clinical record', encounters: 'Encounter', inventory: 'Inventory', laboratory: 'Laboratory', nhis: 'NHIS billing', nursing: 'Nursing record', patients: 'Patient record', pharmacy: 'Medication supply', scheduling: 'Appointments', visits: 'Visit', wards: 'Ward' };
export function WriteRecoveryNotice() {
  const { entries, unavailable } = useSyncExternalStore(subscribeWriteUncertainty, getWriteUncertaintySnapshot, getWriteUncertaintySnapshot);
  const [pending, setPending] = useState(null); const [error, setError] = useState(null);
  if (!entries.length && !unavailable) return null;
  const acknowledge = async (id) => {
    if (pending) return; setPending(id); setError(null);
    try { await acknowledgeWriteReview(id, currentNetworkPrincipal()); } catch { setError('The review could not be acknowledged. Refresh the affected workflow and try again.'); } finally { setPending(null); }
  };
  return <section role="status" aria-label="Changes requiring review" className="border-b border-amber-300/50 bg-amber-50 px-4 py-4 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100 sm:px-6">
    <div className="mx-auto grid max-w-5xl gap-3 text-sm"><p className="font-semibold">Review required before a new change</p>
      {unavailable ? <p>Recovery storage is unavailable or cannot be read safely. New changes are blocked. Restore this browser tab’s storage before continuing; existing unresolved changes must be reviewed.</p> : <>
        <p>A previous request may already have saved. Open the affected workflow and refresh its records or history, then reconcile what happened manually. Lists may be partial. A successful read does not confirm that the request saved or that no record exists.</p>
        <p>You can continue permitted reads. An unchanged request with a supported request key can be retried explicitly from its original form.</p>
        <ul className="grid gap-3">{entries.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/30 p-3"><div><p className="font-medium">{WORKFLOW_LABELS[entry.operation.split('/')[3]] || 'Workflow'} change needs review</p><p className="text-xs">{entry.reviewed ? 'A related response was received after this uncertainty. Review the workflow’s records before acknowledging.' : 'Refresh the affected workflow’s records or history to enable acknowledgment.'}</p></div><Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-left" disabled={!entry.reviewed || Boolean(pending)} onClick={() => acknowledge(entry.id)}>I reviewed the fresh workflow record</Button></li>)}</ul>
      </>}{error && <p role="alert">{error}</p>}
    </div>
  </section>;
}
