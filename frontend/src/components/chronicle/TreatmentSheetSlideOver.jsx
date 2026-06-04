import X from 'lucide-react/dist/esm/icons/x.js';

import { Button } from '@/components/ui/button';
import { TreatmentSheetContent } from '@/features/nursing/components/TreatmentSheetContent';
import { cn } from '@/lib/utils';

const TreatmentSheetSlideOver = ({
  open,
  onClose,
  patient,
  admission,
}) => {
  const admissionId = admission?.id;
  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim()
    : patient?.name || 'Patient';

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-[100] w-full xl:w-4/5 bg-background border-l border-border',
        'transform transition-transform duration-300 ease-in-out',
        'flex flex-col shadow-2xl',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div>
          <h2 className="font-display text-xl text-foreground">Medication Administration Record</h2>
          <p className="font-mono text-xs text-muted-foreground mt-0.5">{patientName}</p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={onClose}
          className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
        >
          <X className="size-4 mr-1.5" />
          Close
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <TreatmentSheetContent
          admissionId={admissionId}
          showHeader={false}
        />
      </div>
    </div>
  );
};

export default TreatmentSheetSlideOver;
