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
import BarChart3 from 'lucide-react/dist/esm/icons/chart-column.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Download from 'lucide-react/dist/esm/icons/download.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
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

/**
 * PatientIdentityHero - Magazine-style patient header
 *
 * Displays patient identity with:
 * - Distinctive typography for name
 * - Key demographics at a glance
 * - Prominent allergy warnings
 * - Quick action buttons
 */
const PatientIdentityHero = ({
  patient,
  onAddNote,
  onRecordVitals,
  onPrescribe,
  onOrderLabs,
  onRequestConsult,
  onShareRecord,
  onReceiveRecord,
  onScheduleFollowUp,
  onViewTreatmentSheet,
  onRecordFluids,
  onAssignChart,
  onStartWardRound,
  onManageInsurance,
  insurance = [],
  activeAdmission,
  activeVisit,
  className
}) => {
  // ============================================
  // Data extraction helpers
  // Handles multiple data structures:
  // - local_data wrapper (from combined API response)
  // - fhir_data (FHIR format)
  // - Direct properties (legacy format)
  // ============================================

  const getDisplayName = (patient) => {
    // Check local_data.user_details first (combined API response)
    if (patient?.local_data?.user_details) {
      const { first_name, last_name } = patient.local_data.user_details;
      return `${first_name || ''} ${last_name || ''}`.trim() || "Unknown Patient";
    }
    // Check FHIR data
    if (patient?.fhir_data?.name?.[0]) {
      const fhirName = patient.fhir_data.name[0];
      const given = fhirName.given?.join(' ') || '';
      const family = fhirName.family || '';
      return `${given} ${family}`.trim() || "Unknown Patient";
    }
    // Check user_details directly
    if (patient?.user_details) {
      const { first_name, last_name } = patient.user_details;
      return `${first_name || ''} ${last_name || ''}`.trim() || "Unknown Patient";
    }
    if (patient?.patient_profile_details?.user_details) {
      const { first_name, last_name } = patient.patient_profile_details.user_details;
      return `${first_name || ''} ${last_name || ''}`.trim() || "Unknown Patient";
    }
    if (patient?.name) return patient.name;
    if (patient?.full_name) return patient.full_name;
    return "Unknown Patient";
  };

  const getPatientMRN = (patient) => {
    // Check local_data first
    if (patient?.local_data?.medical_record_number) {
      return patient.local_data.medical_record_number;
    }
    // Check FHIR identifier
    if (patient?.fhir_data?.identifier) {
      const mrnIdentifier = patient.fhir_data.identifier.find(
        id => id.system?.includes('mrn') || id.type?.coding?.[0]?.code === 'MR'
      );
      if (mrnIdentifier?.value) return mrnIdentifier.value;
    }
    return patient?.medical_record_number ||
      patient?.patient_profile_details?.medical_record_number ||
      patient?.mrn ||
      "No MRN";
  };

  const getPatientAge = (patient) => {
    const dob = patient?.local_data?.user_details?.date_of_birth ||
      patient?.fhir_data?.birthDate ||
      patient?.user_details?.date_of_birth ||
      patient?.patient_profile_details?.user_details?.date_of_birth ||
      patient?.date_of_birth;

    if (!dob) return null;

    try {
      const today = new Date();
      const birthDate = new Date(dob);
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      return age;
    } catch {
      return null;
    }
  };

  const getPatientGender = (patient) => {
    const gender = patient?.local_data?.user_details?.gender ||
      patient?.fhir_data?.gender ||
      patient?.user_details?.gender ||
      patient?.patient_profile_details?.user_details?.gender ||
      patient?.gender;

    if (gender === 'M' || gender === 'male') return 'Male';
    if (gender === 'F' || gender === 'female') return 'Female';
    if (gender === 'O' || gender === 'other') return 'Other';
    return null;
  };

  const getPatientDOB = (patient) => {
    const dob = patient?.local_data?.user_details?.date_of_birth ||
      patient?.fhir_data?.birthDate ||
      patient?.user_details?.date_of_birth ||
      patient?.patient_profile_details?.user_details?.date_of_birth ||
      patient?.date_of_birth;

    if (!dob) return null;

    try {
      return new Date(dob).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return null;
    }
  };

  const getPatientPhone = (patient) => {
    // Check local_data
    if (patient?.local_data?.user_details?.phone_number) {
      return patient.local_data.user_details.phone_number;
    }
    // Check FHIR telecom
    if (patient?.fhir_data?.telecom) {
      const phone = patient.fhir_data.telecom.find(t => t.system === 'phone');
      if (phone?.value) return phone.value;
    }
    return patient?.user_details?.phone ||
      patient?.user_details?.phone_number ||
      patient?.patient_profile_details?.user_details?.phone ||
      patient?.phone ||
      null;
  };

  const getPatientWard = (patient) => {
    return patient?.local_data?.current_ward ||
      patient?.current_ward ||
      patient?.patient_profile_details?.current_ward ||
      null;
  };

  const getPatientBed = (patient) => {
    return patient?.local_data?.current_bed ||
      patient?.current_bed ||
      patient?.patient_profile_details?.current_bed ||
      null;
  };

  const getAllergies = (patient) => {
    // Check local_data for allergies (may be a string)
    const localAllergies = patient?.local_data?.allergies;
    if (localAllergies) {
      // If it's a string, convert to array
      if (typeof localAllergies === 'string') {
        return localAllergies.split(',').map(a => a.trim()).filter(Boolean);
      }
      return localAllergies;
    }
    return patient?.allergies ||
      patient?.patient_profile_details?.allergies ||
      [];
  };

  const getPatientStatus = (patient) => {
    if (patient?.is_critical || patient?.local_data?.is_critical) return 'critical';
    if (patient?.has_alerts || patient?.local_data?.has_alerts) return 'warning';
    return 'stable';
  };

  // ============================================
  // Extracted data
  // ============================================

  const displayName = getDisplayName(patient);
  const mrn = getPatientMRN(patient);
  const age = getPatientAge(patient);
  const gender = getPatientGender(patient);
  const dob = getPatientDOB(patient);
  const phone = getPatientPhone(patient);
  const ward = getPatientWard(patient);
  const bed = getPatientBed(patient);
  const allergies = getAllergies(patient);
  const status = getPatientStatus(patient);

  // Build location string
  const location = ward ? `${ward}${bed ? `, Bed ${bed}` : ''}` : null;

  // ============================================
  // Render
  // ============================================

  return (
    <header className={cn(
      "relative bg-card border-b border-border",
      "px-6 py-8 mb-6",
      className
    )}>
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent" />

      <div className="relative flex items-start justify-between">
        {/* Left: Patient Identity */}
        <div className="space-y-4">
          {/* Status + Name */}
          <div className="flex items-center gap-4">
            {status === 'critical' && (
              <span className="badge-chronicle-rose flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                CRITICAL
              </span>
            )}
            <h1 className="font-display text-4xl md:text-5xl text-foreground tracking-tight">
              {displayName}
            </h1>
          </div>

          {/* Demographics line */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-muted-foreground">
            <span className="font-mono text-sm">
              MRN: <span className="text-foreground">{mrn}</span>
            </span>

            {age && gender && (
              <span className="font-mono text-sm">
                {age} yrs · {gender}
              </span>
            )}

            {dob && (
              <span className="flex items-center gap-1.5 font-mono text-sm">
                <Calendar className="h-3.5 w-3.5" />
                DOB: {dob}
              </span>
            )}

            {phone && (
              <span className="flex items-center gap-1.5 font-mono text-sm">
                <Phone className="h-3.5 w-3.5" />
                {phone}
              </span>
            )}

            {location && (
              <span className="flex items-center gap-1.5 font-mono text-sm">
                <MapPin className="h-3.5 w-3.5" />
                {location}
              </span>
            )}

            {/* Active Visit Status */}
            {activeVisit && (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 font-mono text-sm text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  #{activeVisit.queue_number}
                </span>
                <VisitStatusBadge status={activeVisit.visit_status} size="sm" />
              </div>
            )}

            {/* Insurance Badge */}
            {onManageInsurance && (
              <button
                onClick={onManageInsurance}
                className={cn(
                  "flex items-center gap-1.5 font-mono text-sm px-2 py-0.5 rounded-md transition-colors",
                  "hover:bg-muted cursor-pointer border",
                  insurance.length > 0
                    ? "text-[oklch(0.70_0.15_230)] border-[oklch(0.70_0.15_230_/_0.3)] bg-[oklch(0.70_0.15_230_/_0.05)]"
                    : "text-amber-600 border-amber-300 bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:bg-amber-950"
                )}
              >
                <Shield className="h-3.5 w-3.5" />
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

          {/* Allergies - High visibility */}
          {allergies.length > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20 w-fit">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
              <span className="font-mono text-xs uppercase tracking-wider text-destructive mr-2">
                Allergies:
              </span>
              <div className="flex flex-wrap gap-2">
                {allergies.map((allergy, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded bg-destructive/10 text-destructive font-mono text-xs border border-destructive/30"
                  >
                    {typeof allergy === 'string' ? allergy : allergy.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Quick Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs"
            onClick={onAddNote}
          >
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Add Note
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs"
            onClick={onRecordVitals}
          >
            <Activity className="h-3.5 w-3.5 mr-1.5" />
            Vitals
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs"
            onClick={onPrescribe}
          >
            <Pill className="h-3.5 w-3.5 mr-1.5" />
            Prescribe
          </Button>

          {activeAdmission && onViewTreatmentSheet && (
            <Button
              variant="outline"
              size="sm"
              className="font-mono text-xs"
              onClick={onViewTreatmentSheet}
            >
              <ClipboardList className="h-3.5 w-3.5 mr-1.5" />
              Treatment Sheet
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOrderLabs}>Order Labs</DropdownMenuItem>
              <DropdownMenuItem onClick={onRequestConsult}>Request Consult</DropdownMenuItem>
              <DropdownMenuItem onClick={onScheduleFollowUp}>Schedule Follow-up</DropdownMenuItem>
              {onAssignChart && (
                <DropdownMenuItem onClick={onAssignChart}>
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Assign Chart
                </DropdownMenuItem>
              )}
              {activeAdmission && (
                <>
                  <DropdownMenuSeparator />
                  {onStartWardRound && (
                    <DropdownMenuItem onClick={onStartWardRound}>
                      <Stethoscope className="h-4 w-4 mr-2" />
                      Ward Round
                    </DropdownMenuItem>
                  )}
                  {onRecordFluids && (
                    <DropdownMenuItem onClick={onRecordFluids}>
                      <Droplets className="h-4 w-4 mr-2" />
                      Record Fluids
                    </DropdownMenuItem>
                  )}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => window.print()}>Print Summary</DropdownMenuItem>
              {onShareRecord && (
                <DropdownMenuItem onClick={onShareRecord}>
                  <Shield className="h-4 w-4 mr-2" />
                  Share Record
                </DropdownMenuItem>
              )}
              {onReceiveRecord && (
                <DropdownMenuItem onClick={onReceiveRecord}>
                  <Download className="h-4 w-4 mr-2" />
                  Receive Record
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};

export default PatientIdentityHero;
export { PatientIdentityHero };
