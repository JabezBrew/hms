import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';

import { Button } from '@/components/ui/button';

export function EncounterDetailNotFoundState({ onBack }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="size-16 rounded-full bg-muted flex items-center justify-center mx-auto">
          <FileText className="size-8 text-muted-foreground" />
        </div>
        <h2 className="font-display text-xl text-foreground">Encounter not found</h2>
        <p className="text-muted-foreground text-sm">The requested encounter could not be found.</p>
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="size-4 mr-2" />
          Back to Encounters
        </Button>
      </div>
    </div>
  );
}
