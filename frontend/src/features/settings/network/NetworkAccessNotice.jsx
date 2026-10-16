import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { restrictExpiredDecision, useNetworkDecisionExpired } from './useNetworkDecisionExpired';

function decisionCopy(decision) {
  if (decision.reason === 'policy_unconfigured') return { title: 'Network policy needs operator setup', description: 'Network policy has not been configured. Workflow changes remain unavailable until an operator establishes approved networks.' };
  if (decision.classification === 'unknown') return { title: 'Network origin could not be verified', description: decision.access_allowed ? 'The server could not verify this connection. Workflow changes remain unavailable.' : 'The server could not verify this connection. Facility policy blocks workflow access until an approved connection is confirmed.' };
  if (decision.reauth_required) return { title: 'A fresh sign-in is required', description: 'Confirm your current password to request offsite workflow access under this facility policy. Existing account security requirements still apply.' };
  if (!decision.access_allowed) return { title: 'Workflow access is blocked on this network', description: 'Connect through an approved facility network to continue clinical workflows.' };
  if (decision.read_only) return { title: 'Read-only network access', description: 'You can review permitted records. Workflow changes are unavailable from this connection.' };
  if (decision.classification === 'offsite') return { title: 'Offsite access with a current sign-in', description: 'The server permits workflow access while your existing credential confirmation remains current. This does not confirm fresh multi-factor verification.' };
  return { title: 'Approved network connection', description: 'The server recognizes this connection as onsite. Normal role, patient-access and account security requirements still apply.' };
}
export function NetworkAccessNotice({ decision, loading, error, onRefresh, onReauthenticate }) {
  const expired = useNetworkDecisionExpired(decision);
  decision = restrictExpiredDecision(decision, expired);
  const copy = error ? { title: 'Network access unavailable', description: 'The current network decision could not be confirmed. Refresh before attempting workflow changes.' }
    : loading || !decision ? { title: 'Checking network access', description: 'Waiting for the server to confirm this connection.' } : decisionCopy(decision);
  return <Alert role={error ? 'alert' : 'status'} variant={error || (decision && !decision.access_allowed) ? 'destructive' : 'default'}>
    <AlertTitle className="line-clamp-none">{copy.title}</AlertTitle><AlertDescription><p>{copy.description}</p>
      {decision && !error && !loading && <p className="text-xs">Policy {decision.policy_version === null ? 'not configured' : `version ${decision.policy_version}`} · Checked {new Date(decision.evaluated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
      {decision?.reauth_required && onReauthenticate && <Button type="button" variant="outline" size="sm" onClick={onReauthenticate}>Confirm current password</Button>}
      {error && onRefresh && <Button type="button" variant="outline" size="sm" onClick={onRefresh}>Refresh network access</Button>}
    </AlertDescription>
  </Alert>;
}
