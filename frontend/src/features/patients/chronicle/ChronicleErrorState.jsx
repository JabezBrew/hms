import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';

import { Button } from '@/components/ui/button';

export function ChronicleErrorState({ gateError, pageMeta, onRetry }) {
  return (
    <>
      {pageMeta}
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-display text-foreground">
            Unable to load patient record
          </h2>
          <p className="text-muted-foreground">
            {gateError?.message || 'An error occurred while fetching patient data.'}
          </p>
          <Button onClick={onRetry}>
            <RefreshCw className="size-4 mr-2" />
            Try Again
          </Button>
        </div>
      </div>
    </>
  );
}
