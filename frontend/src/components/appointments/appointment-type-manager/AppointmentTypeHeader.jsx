import PlusCircle from 'lucide-react/dist/esm/icons/circle-plus.js';

import { Button } from '@/components/ui/button';

export function AppointmentTypeHeader({ canMutate, onAddNew }) {
  return (
    <div className="flex justify-between items-center">
      <h2 className="text-xl font-semibold">Appointment Types</h2>
      {canMutate ? (
        <Button onClick={onAddNew} className="flex items-center gap-1">
          <PlusCircle className="size-4" />
          Add New
        </Button>
      ) : null}
    </div>
  );
}
