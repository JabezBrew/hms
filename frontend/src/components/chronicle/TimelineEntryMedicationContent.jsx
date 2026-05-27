import MoreHorizontal from 'lucide-react/dist/esm/icons/ellipsis.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import PauseCircle from 'lucide-react/dist/esm/icons/circle-pause.js';
import PlayCircle from 'lucide-react/dist/esm/icons/circle-play.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import { lazy, Suspense, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const PrescriptionActionsDialog = lazy(() => import('./PrescriptionActionsDialog'));

const getStatusBadge = (status) => {
  const statusConfig = {
    active: {
      label: 'Active',
      className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    },
    on_hold: {
      label: 'On Hold',
      className: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    },
    discontinued: {
      label: 'Discontinued',
      className: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
    },
    completed: {
      label: 'Completed',
      className: 'bg-muted text-muted-foreground border-border',
    },
    draft: {
      label: 'Draft',
      className: 'bg-muted text-muted-foreground border-border',
    },
  };
  return statusConfig[status] || statusConfig.active;
};

export const MedicationContent = ({ medication, entry }) => {
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);
  const prescriptionId = medication?.id || entry?.data?.id || entry?.id;
  const prescriptionForAction = useMemo(
    () => (medication ? { ...medication, id: prescriptionId } : null),
    [medication, prescriptionId]
  );

  if (!medication) return null;

  const status = medication.status || entry?.data?.status || 'active';
  const statusBadge = getStatusBadge(status);
  const handleAction = (action) => {
    setSelectedAction(action);
    setActionDialogOpen(true);
  };

  const canEdit = status === 'active' || status === 'on_hold';
  const canDiscontinue = status === 'active' || status === 'on_hold';
  const canHold = status === 'active';
  const canResume = status === 'on_hold';
  const canRenew = status === 'active' || status === 'completed';
  const hasAnyAction = canEdit || canDiscontinue || canHold || canResume || canRenew;

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-medium text-foreground/90">
          {medication.name || medication.medication_name}
        </h4>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn(
            'text-[10px] px-2 py-0.5 rounded-full border font-medium',
            statusBadge.className
          )}>
            {statusBadge.label}
          </span>
          {hasAnyAction && prescriptionId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-6 p-0 hover:bg-muted"
                >
                  <MoreHorizontal className="size-4" />
                  <span className="sr-only">Prescription actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {canEdit && (
                  <DropdownMenuItem onClick={() => handleAction('edit')}>
                    <Edit className="size-4 mr-2" />
                    Edit Prescription
                  </DropdownMenuItem>
                )}
                {canRenew && (
                  <DropdownMenuItem onClick={() => handleAction('renew')}>
                    <RefreshCw className="size-4 mr-2" />
                    Renew
                  </DropdownMenuItem>
                )}
                {(canEdit || canRenew) && (canHold || canResume || canDiscontinue) && (
                  <DropdownMenuSeparator />
                )}
                {canHold && (
                  <DropdownMenuItem onClick={() => handleAction('hold')}>
                    <PauseCircle className="size-4 mr-2" />
                    Put on Hold
                  </DropdownMenuItem>
                )}
                {canResume && (
                  <DropdownMenuItem onClick={() => handleAction('resume')}>
                    <PlayCircle className="size-4 mr-2" />
                    Resume
                  </DropdownMenuItem>
                )}
                {canDiscontinue && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleAction('discontinue')}
                      className="text-destructive focus:text-destructive"
                    >
                      <XCircle className="size-4 mr-2" />
                      Discontinue
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <p className="font-mono text-sm text-muted-foreground">
        {medication.dose || medication.dosage} {medication.route_display || medication.route}
        {(medication.frequency || medication.frequency_display) &&
          ` · ${medication.frequency_display || medication.frequency}`}
      </p>

      {medication.duration_days && (
        <p className="text-xs text-muted-foreground">
          Duration: {medication.duration_days} days
          {medication.end_date && ` (ends ${new Date(medication.end_date).toLocaleDateString()})`}
        </p>
      )}

      {(medication.notes || medication.instructions) && (
        <p className="text-sm text-muted-foreground mt-2 italic">
          {medication.notes || medication.instructions}
        </p>
      )}

      {status === 'discontinued' && medication.discontinue_reason && (
        <p className="text-xs text-rose-600 mt-2">
          Reason: {medication.discontinue_reason}
        </p>
      )}

      {actionDialogOpen && (
        <Suspense fallback={null}>
          <PrescriptionActionsDialog
            open={actionDialogOpen}
            onOpenChange={setActionDialogOpen}
            prescription={prescriptionForAction}
            action={selectedAction}
            onSuccess={() => {}}
          />
        </Suspense>
      )}
    </div>
  );
};
