import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function ChronicleEmergencyAccess({ expiresAt, busy, error, refreshError, unconfirmed, statusError, onEnd, onRefresh }) {
  if (!expiresAt && !error && !refreshError && !unconfirmed && !statusError) {
    return <Button type="button" variant="ghost" size="sm" onClick={onEnd} disabled={busy}>End my emergency access</Button>;
  }
  return (
    <Alert className="flex flex-col gap-3" variant={error || refreshError ? 'destructive' : 'default'}>
      <AlertTitle>{unconfirmed || statusError ? 'Emergency access needs review' : expiresAt ? 'Emergency access active' : 'Emergency access controls'}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>{expiresAt
          ? `${unconfirmed || statusError ? 'Last confirmed expiry' : 'Access expires'} at ${new Date(expiresAt).toLocaleString()}. End access when urgent care is complete.`
          : 'You can end any temporary emergency grant for this record.'}</p>
        {error && <p role="alert">{error}</p>}
        {statusError && <p role="alert">Current emergency access status could not be checked. Refresh before requesting a grant.</p>}
        {refreshError && <p role="alert">{unconfirmed
          ? 'This record could not be refreshed. Emergency access may have changed. Refresh authorization or try ending access again.'
          : 'The access change was saved, but this record could not be refreshed. Refresh the record; do not request another grant.'}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onEnd} disabled={busy}>{busy ? 'Updating access…' : 'End my emergency access'}</Button>
          {(refreshError || statusError) && <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={busy}>Refresh record</Button>}
        </div>
      </AlertDescription>
    </Alert>
  );
}
