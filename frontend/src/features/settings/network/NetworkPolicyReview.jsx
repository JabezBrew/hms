import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { NETWORK_MODES } from './model';

export function NetworkPolicyReview({ checked }) {
  return <section aria-label="Reviewed network policy" className="grid gap-4 rounded-xl border bg-muted/20 p-4">
    <h3 className="font-semibold">Review the policy to publish</h3><p className="text-sm">The server checked this connection against the candidate policy. Publishing rechecks the connection and the current policy version.</p>
    <dl className="grid min-w-0 gap-3 text-sm"><div><dt className="text-muted-foreground">Canonical approved networks</dt><dd className="mt-1 grid gap-1 font-mono text-xs">{checked.candidate.onsite_cidrs.map((cidr) => <span key={cidr} className="break-all">{cidr}</span>)}</dd></div><div><dt className="text-muted-foreground">Offsite access</dt><dd>{NETWORK_MODES.find((item) => item.value === checked.candidate.offsite_mode)?.label}</dd></div><div><dt className="text-muted-foreground">Recorded reason</dt><dd className="whitespace-pre-wrap break-words">{checked.reason}</dd></div></dl>
    <Alert role="status"><AlertTitle className="line-clamp-none">Current connection retained onsite</AlertTitle><AlertDescription>This is a preview. Other connections are evaluated against the published policy when they make requests. Existing role and patient-access restrictions continue to apply.</AlertDescription></Alert>
  </section>;
}
