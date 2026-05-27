import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Star from 'lucide-react/dist/esm/icons/star.js';
import StarOff from 'lucide-react/dist/esm/icons/star-off.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import UserMinus from 'lucide-react/dist/esm/icons/user-minus.js';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function PatientChronicleStatusRibbon({ status }) {
  return (
    <div className={cn(
      'status-ribbon',
      status === 'critical' && 'status-ribbon-critical',
      status === 'warning' && 'status-ribbon-warning',
      status === 'stable' && 'status-ribbon-stable'
    )} />
  );
}

export function PatientChronicleHeader({ displayName, demographics, status, allergies }) {
  return (
    <header className="flex items-start justify-between gap-2 mb-3 sm:mb-4">
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-lg sm:text-2xl text-foreground tracking-tight truncate">
          {displayName}
        </h3>
        <p className="font-mono text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1 truncate">
          {demographics}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1 sm:gap-2 shrink-0">
        {status === 'critical' && (
          <span className="badge-chronicle-rose flex items-center gap-1 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">
            <AlertTriangle className="size-2.5 sm:h-3 sm:w-3" aria-hidden="true" />
            <span className="hidden sm:inline">CRITICAL</span>
          </span>
        )}
        {allergies.length > 0 && (
          <span className="badge-chronicle-amber text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">
            <span className="sm:hidden">ALLERGY</span>
            <span className="hidden sm:inline">ALLERGIES</span>
          </span>
        )}
      </div>
    </header>
  );
}

export function PatientChronicleSynopsis({ primaryDx, admissionDays, ward, attending }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-6 mb-3 sm:mb-6">
      <div className="min-w-0">
        <dt className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5 sm:mb-1">
          Primary Dx
        </dt>
        <dd className="text-foreground/90 font-medium text-xs sm:text-sm truncate">
          {primaryDx || <span className="text-muted-foreground">Not recorded</span>}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5 sm:mb-1">
          Admitted
        </dt>
        <dd className="text-foreground/90 font-medium text-xs sm:text-sm">
          {admissionDays ? (
            `Day ${admissionDays}`
          ) : ward === 'Waiting List' ? (
            'Waiting List'
          ) : ward ? (
            'Inpatient'
          ) : (
            <span className="text-muted-foreground">Not Admitted</span>
          )}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5 sm:mb-1">
          Attending
        </dt>
        <dd className="text-foreground/90 font-medium text-xs sm:text-sm truncate">
          {attending || <span className="text-muted-foreground">Not assigned</span>}
        </dd>
      </div>
    </div>
  );
}

function VitalDisplay({ label, value, unit = '', trend, status }) {
  const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '';
  const trendClass = cn(
    'font-mono text-[9px] sm:text-xs shrink-0',
    (status === 'critical' || status === 'high') && 'text-destructive',
    status === 'warning' && 'text-primary',
    status === 'low' && 'text-[oklch(0.70_0.15_230)]',
    !['critical', 'high', 'warning', 'low'].includes(status) && 'text-muted-foreground'
  );

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline gap-1">
        <span className="font-mono text-sm sm:text-xl text-foreground truncate">
          {value || '—'}{value && unit}
        </span>
        {trend && (
          <span className={trendClass}>
            {trendIcon}
          </span>
        )}
      </div>
      <span className="font-mono text-[8px] sm:text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

export function PatientChronicleVitals({ vitals }) {
  if (!vitals) return null;

  return (
    <div className="grid grid-cols-4 gap-2 sm:flex sm:items-center sm:gap-4 p-2 sm:p-3 rounded-lg sm:rounded-xl bg-background/50 mb-3 sm:mb-4">
      <VitalDisplay
        label="TEMP"
        value={vitals.temperature}
        unit="°"
        trend={vitals.temperature_trend}
        status={vitals.temperature_status}
      />
      <div className="hidden sm:block w-px h-8 bg-border" />
      <VitalDisplay
        label="BP"
        value={vitals.blood_pressure}
        trend={vitals.bp_trend}
        status={vitals.bp_status}
      />
      <div className="hidden sm:block w-px h-8 bg-border" />
      <VitalDisplay
        label="SpO2"
        value={vitals.spo2}
        unit="%"
        trend={vitals.spo2_trend}
        status={vitals.spo2_status}
      />
      <div className="hidden sm:block w-px h-8 bg-border" />
      <VitalDisplay
        label="HR"
        value={vitals.heart_rate}
        unit=""
        trend={vitals.hr_trend}
        status={vitals.hr_status}
      />
    </div>
  );
}

export function PatientChronicleFooter({ card, actions }) {
  const {
    isPinned,
    pendingOrders,
    isAdmitted,
  } = card;
  const {
    showMyPatientsActions,
    isInMyPatients,
    addToMyPatients,
    removeFromMyPatients,
    togglePin,
    viewRecord,
    startRound,
    startConsultation,
  } = actions;

  return (
    <footer className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 sm:pt-4 border-t border-border">
      <div className="flex items-center gap-2 text-muted-foreground">
        {isPinned && (
          <span className="flex items-center gap-1 text-primary">
            <Star className="size-3 fill-current" aria-hidden="true" />
            <span className="font-mono text-[10px] sm:text-xs">Pinned</span>
          </span>
        )}
        {!isPinned && pendingOrders > 0 && (
          <>
            <span className="size-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
            <span className="font-mono text-[10px] sm:text-xs">{pendingOrders} pending</span>
          </>
        )}
        {!isPinned && pendingOrders === 0 && (
          <span className="font-mono text-[10px] sm:text-xs flex items-center gap-1">
            <Clock className="size-3" aria-hidden="true" />
            No pending items
          </span>
        )}
      </div>

      <div className="pointer-events-auto flex gap-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        {showMyPatientsActions && !isInMyPatients && addToMyPatients && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="font-mono text-[10px] sm:text-xs h-8"
            onClick={addToMyPatients}
          >
            <UserPlus className="size-3 mr-1" />
            Add to List
          </Button>
        )}
        {showMyPatientsActions && isInMyPatients && (
          <>
            {togglePin && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'font-mono text-[10px] sm:text-xs h-8',
                  isPinned && 'text-primary'
                )}
                onClick={togglePin}
              >
                {isPinned ? (
                  <StarOff className="size-3" />
                ) : (
                  <Star className="size-3" />
                )}
              </Button>
            )}
            {removeFromMyPatients && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="font-mono text-[10px] sm:text-xs h-8 text-destructive hover:text-destructive"
                onClick={removeFromMyPatients}
              >
                <UserMinus className="size-3" />
              </Button>
            )}
          </>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="font-mono text-[10px] sm:text-xs h-8 flex-1 sm:flex-none"
          onClick={viewRecord}
        >
          View Record
        </Button>
        {startRound && isAdmitted && (
          <Button
            type="button"
            size="sm"
            className="font-mono text-[10px] sm:text-xs h-8 flex-1 sm:flex-none"
            onClick={startRound}
          >
            Start Round
            <ChevronRight className="size-3 ml-1" />
          </Button>
        )}
        {startConsultation && !isAdmitted && (
          <Button
            type="button"
            size="sm"
            className="font-mono text-[10px] sm:text-xs h-8 flex-1 sm:flex-none"
            onClick={startConsultation}
          >
            Consult
            <ChevronRight className="size-3 ml-1" />
          </Button>
        )}
      </div>
    </footer>
  );
}
