import Lock from 'lucide-react/dist/esm/icons/lock.js';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { WriteRecoveryNotice } from '@/features/settings/network/WriteRecoveryNotice';

/**
 * In-flow notice; shared layouts can also render outside the authenticated shell.
 */
export function ReadOnlyBanner({ className }) {
  const mode = useReadOnlyMode({ optional: true });

  if (!mode?.isReadOnly) {
    return <WriteRecoveryNotice />;
  }

  return (
    <><WriteRecoveryNotice /><div
      className={cn(
        'mb-4 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-3 rounded-xl border bg-muted/40 p-3 text-sm text-foreground sm:grid-cols-[auto_minmax(0,1fr)_auto]',
        className
      )}
      role="status"
    >
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{mode.readonlyMessage || 'Read-only access. Workflow changes are unavailable from this connection.'}</span>
      {mode.reauthRequired && <Button type="button" variant="outline" size="sm" className="col-start-2 w-fit sm:col-start-3" onClick={mode.requestReauthentication}>Confirm current password</Button>}
    </div></>
  );
}
