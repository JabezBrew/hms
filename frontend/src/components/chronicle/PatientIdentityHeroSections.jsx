import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/ellipsis.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Droplets from 'lucide-react/dist/esm/icons/droplets.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Download from 'lucide-react/dist/esm/icons/download.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import LogOut from 'lucide-react/dist/esm/icons/log-out.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { VisitStatusBadge } from "@/components/visits/VisitStatusBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function getAllergyLabel(allergy) {
  if (typeof allergy === 'string') {
    return allergy;
  }
  return allergy.name || allergy.allergen_name || allergy.substance || allergy.allergen;
}

function PatientStatusHeading({ displayName, status }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-4">
      {status === 'critical' && (
        <span className="badge-chronicle-rose flex items-center gap-1">
          <AlertTriangle className="size-3" />
          CRITICAL
        </span>
      )}
      <h1 className="min-w-0 [overflow-wrap:anywhere] font-display text-4xl md:text-5xl text-foreground tracking-tight">
        {displayName}
      </h1>
    </div>
  );
}

function PatientDemographics({
  activeAdmission,
  activeVisit,
  age,
  dob,
  gender,
  insurance,
  location,
  mrn,
  onManageInsurance,
  onStartDischarge,
  phone,
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2 text-muted-foreground">
      <span className="min-w-0 [overflow-wrap:anywhere] font-mono text-sm">
        MRN: <span className="text-foreground">{mrn}</span>
      </span>

      {age && gender && (
        <span className="font-mono text-sm">
          {age} yrs · {gender}
        </span>
      )}

      {dob && (
        <span className="flex items-center gap-1.5 font-mono text-sm">
          <Calendar className="size-3.5" />
          DOB: {dob}
        </span>
      )}

      {phone && (
        <span className="flex items-center gap-1.5 font-mono text-sm">
          <Phone className="size-3.5" />
          {phone}
        </span>
      )}

      {location && (
        <span className="flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere] font-mono text-sm">
          <MapPin className="size-3.5" />
          {location}
        </span>
      )}

      {activeAdmission && onStartDischarge && (
        <button
          type="button"
          onClick={onStartDischarge}
          className="flex items-center gap-1.5 font-mono text-sm px-2 py-0.5 rounded-md transition-colors hover:bg-muted cursor-pointer border text-rose-600 border-rose-300 bg-rose-50 dark:text-rose-400 dark:border-rose-700 dark:bg-rose-950"
        >
          <LogOut className="size-3.5" />
          Discharge
        </button>
      )}

      {activeVisit && (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 font-mono text-sm text-muted-foreground">
            <Users className="size-3.5" />
            #{activeVisit.queue_number}
          </span>
          <VisitStatusBadge status={activeVisit.visit_status} size="sm" />
        </div>
      )}

      {onManageInsurance && (
        <button
          type="button"
          onClick={onManageInsurance}
          className={cn(
            "flex items-center gap-1.5 font-mono text-sm px-2 py-0.5 rounded-md transition-colors",
            "hover:bg-muted cursor-pointer border",
            insurance.length > 0
              ? "text-[oklch(0.70_0.15_230)] border-[oklch(0.70_0.15_230_/_0.3)] bg-[oklch(0.70_0.15_230_/_0.05)]"
              : "text-amber-600 border-amber-300 bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:bg-amber-950"
          )}
        >
          <Shield className="size-3.5" />
          {insurance.length > 0 ? (
            <span>
              {insurance[0]?.plan_name || 'Insured'}
              {insurance.length > 1 && ` +${insurance.length - 1}`}
            </span>
          ) : (
            <span>No Insurance</span>
          )}
        </button>
      )}
    </div>
  );
}

function AllergyWarnings({ allergies }) {
  if (allergies.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20 w-fit">
      <AlertTriangle className="size-4 text-destructive shrink-0" />
      <span className="font-mono text-xs uppercase tracking-wider text-destructive mr-2">
        Allergies:
      </span>
      <div className="flex flex-wrap gap-2">
        {allergies.map((allergy) => {
          const label = getAllergyLabel(allergy);
          const key = typeof allergy === 'string'
            ? allergy
            : allergy.id || allergy.uuid || allergy.code || label;

          return (
            <span
              key={key}
              className="px-2 py-0.5 rounded bg-destructive/10 text-destructive font-mono text-xs border border-destructive/30"
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PrimaryActions({ actions, activeAdmission, prefetchAction }) {
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="font-mono text-xs"
        data-onboarding="chronicle-add-note"
        onClick={actions.onAddNote}
        onPointerEnter={() => prefetchAction('note')}
        onFocus={() => prefetchAction('note')}
      >
        <FileText className="size-3.5 mr-1.5" />
        Add Note
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="font-mono text-xs"
        onClick={actions.onRecordVitals}
        onPointerEnter={() => prefetchAction('vitals')}
        onFocus={() => prefetchAction('vitals')}
      >
        <Activity className="size-3.5 mr-1.5" />
        Vitals
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="font-mono text-xs"
        data-onboarding="chronicle-prescribe"
        onClick={actions.onPrescribe}
        onPointerEnter={() => prefetchAction('prescription')}
        onFocus={() => prefetchAction('prescription')}
      >
        <Pill className="size-3.5 mr-1.5" />
        Prescribe
      </Button>

      {actions.onOrderLabs && (
        <Button
          variant="outline"
          size="sm"
          className="font-mono text-xs"
          onClick={actions.onOrderLabs}
          onPointerEnter={() => prefetchAction('labs')}
          onFocus={() => prefetchAction('labs')}
        >
          <FlaskConical className="size-3.5 mr-1.5" />
          Order Labs
        </Button>
      )}

      {activeAdmission && actions.onViewTreatmentSheet && (
        <Button
          variant="outline"
          size="sm"
          className="font-mono text-xs"
          onClick={actions.onViewTreatmentSheet}
        >
          <ClipboardList className="size-3.5 mr-1.5" />
          Treatment Sheet
        </Button>
      )}
    </>
  );
}

function MoreActionsMenu({ actions, activeAdmission, prefetchAction }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="More actions"
          data-onboarding="chronicle-more-actions"
          onPointerEnter={() => {
            prefetchAction('labs');
            prefetchAction('referral');
            prefetchAction('medicationHistory');
          }}
          onFocus={() => {
            prefetchAction('labs');
            prefetchAction('referral');
            prefetchAction('medicationHistory');
          }}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.onAskChronicle && (
          <DropdownMenuItem
            onClick={actions.onAskChronicle}
            onPointerEnter={() => prefetchAction('copilot')}
            onFocus={() => prefetchAction('copilot')}
            className="text-amber-900 dark:text-amber-100 focus:bg-amber-50 dark:focus:bg-amber-950/40"
          >
            <Sparkles className="size-4 mr-2 text-amber-600 dark:text-amber-300" />
            Ask Chronicle
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={actions.onOrderLabs}
          onPointerEnter={() => prefetchAction('labs')}
          onFocus={() => prefetchAction('labs')}
        >
          Order Labs
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={actions.onRequestConsult}
          onPointerEnter={() => prefetchAction('referral')}
          onFocus={() => prefetchAction('referral')}
        >
          Request Consult
        </DropdownMenuItem>
        {actions.onViewMedicationHistory && (
          <DropdownMenuItem
            onClick={actions.onViewMedicationHistory}
            onPointerEnter={() => prefetchAction('medicationHistory')}
            onFocus={() => prefetchAction('medicationHistory')}
          >
            <Pill className="size-4 mr-2" />
            Medication History
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={actions.onScheduleFollowUp}>Schedule Follow-up</DropdownMenuItem>
        {actions.onRecordFluids && (
          <DropdownMenuItem
            onClick={actions.onRecordFluids}
            onPointerEnter={() => prefetchAction('fluids')}
            onFocus={() => prefetchAction('fluids')}
          >
            <Droplets className="size-4 mr-2" />
            Fluid Balance
          </DropdownMenuItem>
        )}
        {activeAdmission && actions.onStartWardRound && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={actions.onStartWardRound}
              onPointerEnter={() => prefetchAction('wardRound')}
              onFocus={() => prefetchAction('wardRound')}
            >
              <Stethoscope className="size-4 mr-2" />
              Ward Round
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={actions.onPrintSummary || (() => window.print())}>Print Summary</DropdownMenuItem>
        {actions.onShareRecord && (
          <DropdownMenuItem
            onClick={actions.onShareRecord}
            onPointerEnter={() => prefetchAction('crossFacility')}
            onFocus={() => prefetchAction('crossFacility')}
          >
            <Shield className="size-4 mr-2" />
            Share Record
          </DropdownMenuItem>
        )}
        {actions.onReceiveRecord && (
          <DropdownMenuItem
            onClick={actions.onReceiveRecord}
            onPointerEnter={() => prefetchAction('receiveRecord')}
            onFocus={() => prefetchAction('receiveRecord')}
          >
            <Download className="size-4 mr-2" />
            Receive Record
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PatientActions({ actions, activeAdmission, prefetchAction }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 xl:max-w-[32rem] xl:justify-end">
      <PrimaryActions
        actions={actions}
        activeAdmission={activeAdmission}
        prefetchAction={prefetchAction}
      />

      <MoreActionsMenu
        actions={actions}
        activeAdmission={activeAdmission}
        prefetchAction={prefetchAction}
      />
    </div>
  );
}

export function PatientIdentityHeroLayout({
  actions,
  className,
  clinicalContext,
  patientSummary,
  prefetchAction,
}) {
  return (
    <header className={cn(
      "relative max-w-full overflow-hidden bg-card border-b border-border",
      "px-4 py-6 mb-6 sm:px-6 sm:py-8",
      className
    )}>
      <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent" />

      <div className="relative flex min-w-0 flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-4">
          <PatientStatusHeading
            displayName={patientSummary.displayName}
            status={patientSummary.status}
          />

          <PatientDemographics
            activeAdmission={clinicalContext.activeAdmission}
            activeVisit={clinicalContext.activeVisit}
            age={patientSummary.age}
            dob={patientSummary.dob}
            gender={patientSummary.gender}
            insurance={clinicalContext.insurance}
            location={patientSummary.location}
            mrn={patientSummary.mrn}
            onManageInsurance={actions.onManageInsurance}
            onStartDischarge={actions.onStartDischarge}
            phone={patientSummary.phone}
          />

          <AllergyWarnings allergies={patientSummary.allergies} />
        </div>

        <PatientActions
          actions={actions}
          activeAdmission={clinicalContext.activeAdmission}
          prefetchAction={prefetchAction}
        />
      </div>
    </header>
  );
}
