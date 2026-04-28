import Activity from 'lucide-react/dist/esm/icons/activity.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Star from 'lucide-react/dist/esm/icons/star.js';
import StarOff from 'lucide-react/dist/esm/icons/star-off.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import UserMinus from 'lucide-react/dist/esm/icons/user-minus.js';
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * PatientChronicleCard - A magazine-style patient card for the Chronicle design system
 *
 * Displays patient information in a narrative-focused format with:
 * - Priority status ribbon
 * - Patient identity with distinctive typography
 * - Clinical synopsis (diagnosis, admission, attending)
 * - Vital signs sparkline
 * - Contextual actions
 */
const PatientChronicleCard = ({
  patient,
  index = 0,
  onStartRound,
  onStartConsultation,
  onAddToMyPatients,
  onRemoveFromMyPatients,
  onTogglePin,
  onPrefetchPatient,
  showMyPatientsActions = false,
  isInMyPatients = false,
  className
}) => {
  const navigate = useNavigate();

  // ============================================
  // Data extraction helpers (matching existing patterns)
  // ============================================

  const getPatientId = (patient) => {
    if (patient?.id) return patient.id;
    if (patient?.patient_profile) return patient.patient_profile;
    if (patient?.local_data?.id) return patient.local_data.id;
    if (patient?.fhir_data?.id) return patient.fhir_data.id;
    return null;
  };

  const getDisplayName = (patient) => {
    // Check for simple name field first (from search API)
    if (patient?.name) {
      return patient.name;
    }
    if (patient?.user_details) {
      const { first_name, last_name } = patient.user_details;
      return `${first_name || ''} ${last_name || ''}`.trim() || "Unknown Patient";
    }
    if (patient?.patient_profile_details?.user_details) {
      const { first_name, last_name } = patient.patient_profile_details.user_details;
      return `${first_name || ''} ${last_name || ''}`.trim() || "Unknown Patient";
    }
    if (patient?.local_data?.user_details) {
      return `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim() || "Unknown Patient";
    }
    return "Unknown Patient";
  };

  const getPatientMRN = (patient) => {
    return patient?.medical_record_number ||
      patient?.patient_profile_details?.medical_record_number ||
      patient?.local_data?.medical_record_number ||
      "No MRN";
  };

  const getPatientAge = (patient) => {
    const dob = patient?.user_details?.date_of_birth ||
      patient?.patient_profile_details?.user_details?.date_of_birth ||
      patient?.local_data?.user_details?.date_of_birth;

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
    const gender = patient?.user_details?.gender ||
      patient?.patient_profile_details?.user_details?.gender ||
      patient?.local_data?.user_details?.gender;

    if (gender === 'M') return 'M';
    if (gender === 'F') return 'F';
    return null;
  };

  const getPatientWard = (patient) => {
    const ward = patient?.current_ward ||
      patient?.patient_profile_details?.current_ward ||
      patient?.local_data?.current_ward ||
      null;

    return ward;
  };

  const getPatientBed = (patient) => {
    return patient?.current_bed ||
      patient?.patient_profile_details?.current_bed ||
      patient?.local_data?.current_bed ||
      null;
  };

  const getAdmissionDays = (patient) => {
    const admissionDate = patient?.admission_date ||
      patient?.patient_profile_details?.admission_date ||
      patient?.local_data?.admission_date;

    if (!admissionDate) return null;

    try {
      const admission = new Date(admissionDate);
      const today = new Date();
      const diffTime = Math.abs(today - admission);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays;
    } catch {
      return null;
    }
  };

  const getAllergies = (patient) => {
    return patient?.allergies ||
      patient?.patient_profile_details?.allergies ||
      patient?.local_data?.allergies ||
      [];
  };

  const getPrimaryDiagnosis = (patient) => {
    return patient?.primary_diagnosis ||
      patient?.patient_profile_details?.primary_diagnosis ||
      patient?.local_data?.primary_diagnosis ||
      patient?.chief_complaint ||
      null;
  };

  const getAttendingPhysician = (patient) => {
    return patient?.attending_physician ||
      patient?.patient_profile_details?.attending_physician ||
      null;
  };

  const getVitals = (patient) => {
    return patient?.latest_vitals ||
      patient?.vitals ||
      null;
  };

  const getPatientStatus = (patient) => {
    // Determine patient status/priority
    const vitals = getVitals(patient);
    if (patient?.is_critical || vitals?.is_critical) return 'critical';
    if (patient?.has_alerts || patient?.pending_orders > 0) return 'warning';
    return 'stable';
  };

  const getPendingOrders = (patient) => {
    return patient?.pending_orders || 0;
  };

  const getIsAdmitted = (patient) => {
    return !!(
      patient?.current_admission_id ||
      patient?.local_data?.current_admission_id ||
      patient?.patient_profile_details?.current_admission_id ||
      patient?.admission_status === 'admitted' ||
      patient?.local_data?.admission_status === 'admitted'
    );
  };

  // ============================================
  // Extracted data
  // ============================================

  const patientId = getPatientId(patient);
  const displayName = getDisplayName(patient);
  const mrn = getPatientMRN(patient);
  const age = getPatientAge(patient);
  const gender = getPatientGender(patient);
  const ward = getPatientWard(patient);
  const bed = getPatientBed(patient);
  const admissionDays = getAdmissionDays(patient);
  const allergies = getAllergies(patient);
  const primaryDx = getPrimaryDiagnosis(patient);
  const attending = getAttendingPhysician(patient);
  const vitals = getVitals(patient);
  const status = getPatientStatus(patient);
  const pendingOrders = getPendingOrders(patient);
  const isAdmitted = getIsAdmitted(patient);

  // Build location string
  const location = [ward, bed ? `Bed ${bed}` : null].filter(Boolean).join(', ');

  // Build demographics string
  const demographics = [
    mrn,
    age ? `${age}${gender || ''}` : null,
    location || null
  ].filter(Boolean).join(' · ');

  // ============================================
  // Event handlers
  // ============================================

  const handleViewRecord = () => {
    if (patientId) {
      if (onPrefetchPatient) {
        onPrefetchPatient(patientId, 'navigation');
      }
      navigate(`/patients/${patientId}`);
    }
  };

  const handleIntentPrefetch = () => {
    if (onPrefetchPatient && patientId) {
      onPrefetchPatient(patientId, 'hover');
    }
  };

  const handleStartRound = (e) => {
    e.stopPropagation();
    if (onStartRound) {
      onStartRound(patient);
    }
  };

  const handleStartConsultation = (e) => {
    e.stopPropagation();
    if (onStartConsultation) {
      onStartConsultation(patient);
    }
  };

  const handleAddToMyPatients = (e) => {
    e.stopPropagation();
    if (onAddToMyPatients) {
      onAddToMyPatients(patientId);
    }
  };

  const handleRemoveFromMyPatients = (e) => {
    e.stopPropagation();
    if (onRemoveFromMyPatients) {
      onRemoveFromMyPatients(patientId);
    }
  };

  const handleTogglePin = (e) => {
    e.stopPropagation();
    if (onTogglePin && patient?._listEntryId) {
      onTogglePin(patient._listEntryId);
    }
  };

  // Check if patient is pinned (from My Patients data)
  const isPinned = patient?._isPinned;

  // ============================================
  // Render
  // ============================================

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleViewRecord();
    }
  };

  return (
    <article
      onClick={handleViewRecord}
      onKeyDown={handleKeyDown}
      onPointerEnter={handleIntentPrefetch}
      onFocus={handleIntentPrefetch}
      tabIndex={0}
      role="button"
      aria-label={`View patient ${displayName}, ${mrn}`}
      className={cn(
        "group relative bg-card/50 backdrop-blur border border-border",
        "rounded-xl sm:rounded-2xl p-4 sm:p-6 cursor-pointer",
        "hover:border-primary/30 transition-all duration-500",
        "hover:shadow-[0_0_40px_-12px_var(--chronicle-amber)]",
        "animate-chronicle-enter",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Status Ribbon */}
      <div className={cn(
        "status-ribbon",
        status === 'critical' && "status-ribbon-critical",
        status === 'warning' && "status-ribbon-warning",
        status === 'stable' && "status-ribbon-stable"
      )} />

      {/* Header: Patient Identity */}
      <header className="flex items-start justify-between gap-2 mb-3 sm:mb-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg sm:text-2xl text-foreground tracking-tight truncate">
            {displayName}
          </h3>
          <p className="font-mono text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1 truncate">
            {demographics}
          </p>
        </div>

        {/* Status Badges - Stack on mobile */}
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1 sm:gap-2 shrink-0">
          {status === 'critical' && (
            <span className="badge-chronicle-rose flex items-center gap-1 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">
              <AlertTriangle className="h-2.5 w-2.5 sm:h-3 sm:w-3" aria-hidden="true" />
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

      {/* Clinical Synopsis - Stack on mobile */}
      <div className="grid grid-cols-3 gap-2 sm:gap-6 mb-3 sm:mb-6">
        <div className="min-w-0">
          <dt className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5 sm:mb-1">
            Primary Dx
          </dt>
          <dd className="text-foreground/90 font-medium text-xs sm:text-sm truncate">
            {primaryDx || <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5 sm:mb-1">
            Admitted
          </dt>
          <dd className="text-foreground/90 font-medium text-xs sm:text-sm">
            {admissionDays ? (
              `Day ${admissionDays}`
            ) : ward === "Waiting List" ? (
              "Waiting List"
            ) : ward ? (
              "Inpatient"
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
            {attending || <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
      </div>

      {/* Vital Signs - Wrap on mobile */}
      {vitals && (
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
      )}

      {/* Action Footer - Always visible on mobile */}
      <footer className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 sm:pt-4 border-t border-border">
        <div className="flex items-center gap-2 text-muted-foreground">
          {/* Pinned indicator for My Patients */}
          {isPinned && (
            <span className="flex items-center gap-1 text-primary">
              <Star className="h-3 w-3 fill-current" aria-hidden="true" />
              <span className="font-mono text-[10px] sm:text-xs">Pinned</span>
            </span>
          )}
          {!isPinned && pendingOrders > 0 && (
            <>
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
              <span className="font-mono text-[10px] sm:text-xs">{pendingOrders} pending</span>
            </>
          )}
          {!isPinned && pendingOrders === 0 && (
            <span className="font-mono text-[10px] sm:text-xs flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden="true" />
              No pending items
            </span>
          )}
        </div>

        {/* Always show on mobile, hover on desktop */}
        <div className="flex gap-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          {/* My Patients actions */}
          {showMyPatientsActions && !isInMyPatients && onAddToMyPatients && (
            <Button
              variant="ghost"
              size="sm"
              className="font-mono text-[10px] sm:text-xs h-8"
              onClick={handleAddToMyPatients}
            >
              <UserPlus className="h-3 w-3 mr-1" />
              Add to List
            </Button>
          )}
          {showMyPatientsActions && isInMyPatients && (
            <>
              {onTogglePin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "font-mono text-[10px] sm:text-xs h-8",
                    isPinned && "text-primary"
                  )}
                  onClick={handleTogglePin}
                >
                  {isPinned ? (
                    <StarOff className="h-3 w-3" />
                  ) : (
                    <Star className="h-3 w-3" />
                  )}
                </Button>
              )}
              {onRemoveFromMyPatients && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="font-mono text-[10px] sm:text-xs h-8 text-destructive hover:text-destructive"
                  onClick={handleRemoveFromMyPatients}
                >
                  <UserMinus className="h-3 w-3" />
                </Button>
              )}
            </>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="font-mono text-[10px] sm:text-xs h-8 flex-1 sm:flex-none"
            onClick={handleViewRecord}
          >
            View Record
          </Button>
          {onStartRound && isAdmitted && (
            <Button
              size="sm"
              className="font-mono text-[10px] sm:text-xs h-8 flex-1 sm:flex-none"
              onClick={handleStartRound}
            >
              Start Round
              <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          )}
          {onStartConsultation && !isAdmitted && (
            <Button
              size="sm"
              className="font-mono text-[10px] sm:text-xs h-8 flex-1 sm:flex-none"
              onClick={handleStartConsultation}
            >
              Consult
              <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </div>
      </footer>
    </article>
  );
};

/**
 * VitalDisplay - Mini vital sign display with trend indicator
 */
const VitalDisplay = ({ label, value, unit = '', trend, status }) => {
  const getTrendIcon = () => {
    if (trend === 'up') return '↑';
    if (trend === 'down') return '↓';
    return '';
  };

  const getTrendColor = () => {
    if (status === 'critical' || status === 'high') return 'text-destructive';
    if (status === 'warning') return 'text-primary';
    if (status === 'low') return 'text-[oklch(0.70_0.15_230)]';
    return 'text-muted-foreground';
  };

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline gap-1">
        <span className="font-mono text-sm sm:text-xl text-foreground truncate">
          {value || '—'}{value && unit}
        </span>
        {trend && (
          <span className={cn("font-mono text-[9px] sm:text-xs shrink-0", getTrendColor())}>
            {getTrendIcon()}
          </span>
        )}
      </div>
      <span className="font-mono text-[8px] sm:text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
};

export default PatientChronicleCard;
export { PatientChronicleCard };
