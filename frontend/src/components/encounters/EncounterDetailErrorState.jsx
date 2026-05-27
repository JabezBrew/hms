import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';

import { Button } from '@/components/ui/button';

export function EncounterDetailErrorState({ message, onBack }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="size-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
          <XCircle className="size-8 text-destructive" />
        </div>
        <h2 className="font-display text-xl text-foreground">Unable to load encounter</h2>
        <p className="text-muted-foreground text-sm">{message || 'Please try again'}</p>
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="size-4 mr-2" />
          Back to Encounters
        </Button>
      </div>
    </div>
  );
}
