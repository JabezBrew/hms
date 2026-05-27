import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';

import { Button } from '@/components/ui/button';

export function EncounterListErrorState({ error, onRetry }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="size-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
          <AlertTriangle className="size-8 text-destructive" />
        </div>
        <h2 className="font-display text-2xl text-foreground">Error Loading Encounters</h2>
        <p className="text-muted-foreground">{error?.message || 'Failed to load encounters.'}</p>
        <Button onClick={onRetry} className="font-mono text-xs">
          <RefreshCw className="size-4 mr-2" />
          Retry
        </Button>
      </div>
    </div>
  );
}
