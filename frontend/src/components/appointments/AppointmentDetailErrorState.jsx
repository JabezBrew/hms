import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';

import { Button } from '@/components/ui/button';

export function AppointmentDetailErrorState({ message, onBack }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="size-16 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
        <AlertCircle className="size-8 text-destructive" />
      </div>
      <h2 className="font-display text-2xl text-foreground mb-2">
        Unable to Load Appointment
      </h2>
      <p className="text-muted-foreground font-mono text-sm mb-6">
        {message || 'Failed to load appointment details'}
      </p>
      <Button onClick={onBack} variant="outline" className="font-mono text-xs">
        <ArrowLeft className="mr-2 size-4" />
        Back to Appointments
      </Button>
    </div>
  );
}
