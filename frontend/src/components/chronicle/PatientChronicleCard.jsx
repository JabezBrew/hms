import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Activity, AlertTriangle, Clock, ChevronRight } from "lucide-react";

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
    return patient?.current_ward ||
      patient?.patient_profile_details?.current_ward ||
      patient?.local_data?.current_ward ||
      null;
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
      navigate(`/patients/${patientId}`);
    }
  };

  const handleStartRound = (e) => {
    e.stopPropagation();
    if (onStartRound) {
      onStartRound(patient);
    }
  };

  // ============================================
  // Render
  // ============================================

  return (
    <article
      onClick={handleViewRecord}
      className={cn(
        "group relative bg-card/50 backdrop-blur border border-border",
        "rounded-2xl p-6 cursor-pointer",
        "hover:border-primary/30 transition-all duration-500",
        "hover:shadow-[0_0_40px_-12px_var(--chronicle-amber)]",
        "animate-chronicle-enter",
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
      <header className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-display text-2xl text-foreground tracking-tight">
            {displayName}
          </h3>
          <p className="font-mono text-xs text-muted-foreground mt-1">
            {demographics}
          </p>
        </div>

        {/* Status Badges */}
        <div className="flex items-center gap-2">
          {status === 'critical' && (
            <span className="badge-chronicle-rose flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              CRITICAL
            </span>
          )}
          {allergies.length > 0 && (
            <span className="badge-chronicle-amber">
              ALLERGIES
            </span>
          )}
        </div>
      </header>

      {/* Clinical Synopsis */}
      <div className="grid grid-cols-3 gap-6 mb-6">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Primary Dx
          </dt>
          <dd className="text-foreground/90 font-medium text-sm">
            {primaryDx || <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Admitted
          </dt>
          <dd className="text-foreground/90 font-medium text-sm">
            {admissionDays ? (
              `Day ${admissionDays}`
            ) : (
              <span className="text-muted-foreground">Outpatient</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Attending
          </dt>
          <dd className="text-foreground/90 font-medium text-sm">
            {attending || <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
      </div>

      {/* Vital Signs Sparkline */}
      {vitals && (
        <div className="flex items-center gap-4 p-3 rounded-xl bg-background/50 mb-4">
          <VitalDisplay
            label="TEMP"
            value={vitals.temperature}
            unit="°"
            trend={vitals.temperature_trend}
            status={vitals.temperature_status}
          />
          <div className="w-px h-8 bg-border" />
          <VitalDisplay
            label="BP"
            value={vitals.blood_pressure}
            trend={vitals.bp_trend}
            status={vitals.bp_status}
          />
          <div className="w-px h-8 bg-border" />
          <VitalDisplay
            label="SpO2"
            value={vitals.spo2}
            unit="%"
            trend={vitals.spo2_trend}
            status={vitals.spo2_status}
          />
          <div className="w-px h-8 bg-border" />
          <VitalDisplay
            label="HR"
            value={vitals.heart_rate}
            unit=" bpm"
            trend={vitals.hr_trend}
            status={vitals.hr_status}
          />
        </div>
      )}

      {/* Action Footer */}
      <footer className="flex items-center justify-between pt-4 border-t border-border">
        <div className="flex items-center gap-2 text-muted-foreground">
          {pendingOrders > 0 && (
            <>
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="font-mono text-xs">{pendingOrders} pending orders</span>
            </>
          )}
          {pendingOrders === 0 && (
            <span className="font-mono text-xs flex items-center gap-1">
              <Clock className="h-3 w-3" />
              No pending items
            </span>
          )}
        </div>

        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="secondary"
            size="sm"
            className="font-mono text-xs"
            onClick={handleViewRecord}
          >
            View Record
          </Button>
          {onStartRound && (
            <Button
              size="sm"
              className="font-mono text-xs"
              onClick={handleStartRound}
            >
              Start Round
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
    return '→';
  };

  const getTrendColor = () => {
    if (status === 'critical' || status === 'high') return 'text-destructive';
    if (status === 'warning') return 'text-primary';
    if (status === 'low') return 'text-[oklch(0.70_0.15_230)]';
    return 'text-muted-foreground';
  };

  return (
    <div className="flex-1">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xl text-foreground">
          {value || '—'}{value && unit}
        </span>
        {trend && (
          <span className={cn("font-mono text-xs", getTrendColor())}>
            {getTrendIcon()} {status?.toUpperCase()}
          </span>
        )}
      </div>
      <span className="font-mono text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
};

export default PatientChronicleCard;
export { PatientChronicleCard };
