import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';

import { Button } from '@/components/ui/button';

export function AppointmentDetailEmptyState({ onBack }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-6">
        <AlertCircle className="size-8 text-muted-foreground" />
      </div>
      <h2 className="font-display text-2xl text-foreground mb-2">
        Appointment Not Found
      </h2>
      <p className="text-muted-foreground font-mono text-sm mb-6">
        The appointment you're looking for doesn't exist or has been deleted.
      </p>
      <Button onClick={onBack} variant="outline" className="font-mono text-xs">
        <ArrowLeft className="mr-2 size-4" />
        Back to Appointments
      </Button>
    </div>
  );
}
