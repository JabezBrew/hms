import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatEncounterDateShort } from './encounterDetailUtils';

function EncounterDetailActions({
  actionState,
  encounterId,
  onCancel,
  onDischarge,
  onNavigate,
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {actionState.canEdit && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNavigate(`/encounters/${encounterId}/edit`)}
        >
          <Edit className="size-4 mr-2" />
          <span className="hidden sm:inline">Edit</span>
        </Button>
      )}
      {actionState.canDischarge && (
        <Button
          variant="outline"
          size="sm"
          onClick={onDischarge}
          className="text-emerald-600 hover:text-emerald-600 hover:bg-emerald-500/10"
        >
          <CheckCircle className="size-4 sm:mr-2" />
          <span className="hidden sm:inline">Discharge</span>
        </Button>
      )}
      {actionState.canCancel && (
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <XCircle className="size-4 sm:mr-2" />
          <span className="hidden sm:inline">Cancel</span>
        </Button>
      )}
    </div>
  );
}

function EncounterIdentity({ encounter, statusConfig, typeConfig }) {
  const StatusIcon = statusConfig.icon;
  const TypeIcon = typeConfig.icon;

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
      <div className={cn(
        "size-14 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0",
        typeConfig.badgeClass.replace('text-', 'bg-').replace('/10', '/20')
      )}>
        <TypeIcon className="size-7 sm:h-8 sm:w-8 text-foreground/70" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h1 className="font-display text-xl sm:text-2xl lg:text-3xl text-foreground tracking-tight">
            {typeConfig.label}
          </h1>
          <span className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium",
            statusConfig.badgeClass
          )}>
            <StatusIcon className="size-3" />
            {statusConfig.label}
          </span>
        </div>

        {encounter.patient_name && (
          <Link
            to={`/patients/${encounter.patient}`}
            className="inline-flex items-center gap-2 text-primary hover:underline mb-2"
          >
            <User className="size-4" />
            <span className="font-medium">{encounter.patient_name}</span>
            <ExternalLink className="size-3" />
          </Link>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {encounter.practitioner_name && (
            <span className="flex items-center gap-1.5">
              <Stethoscope className="size-3.5" />
              {encounter.practitioner_name}
            </span>
          )}
          {encounter.location && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-3.5" />
              {encounter.location}
            </span>
          )}
          {encounter.start_time && (
            <span className="flex items-center gap-1.5">
              <Calendar className="size-3.5" />
              {formatEncounterDateShort(encounter.start_time)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function EncounterDetailHeader({
  actionState,
  encounter,
  encounterId,
  onCancel,
  onDischarge,
  onNavigate,
  statusConfig,
  typeConfig,
}) {
  return (
    <header className="bg-card border-b border-border">
      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigate('/encounters')}
            className="self-start -ml-2"
          >
            <ChevronLeft className="size-4 mr-1" />
            Encounters
          </Button>

          <EncounterDetailActions
            actionState={actionState}
            encounterId={encounterId}
            onCancel={onCancel}
            onDischarge={onDischarge}
            onNavigate={onNavigate}
          />
        </div>

        {actionState.dischargeHandledByAdmissionWorkflow && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Inpatient discharge is handled by admission discharge workflows in Rust V2.
          </div>
        )}

        <EncounterIdentity
          encounter={encounter}
          statusConfig={statusConfig}
          typeConfig={typeConfig}
        />
      </div>
    </header>
  );
}
