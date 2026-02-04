import Clock from 'lucide-react/dist/esm/icons/clock.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * RecentPatientsSection - Horizontal scrollable row of recently accessed patients
 *
 * Features:
 * - Compact patient cards in horizontal scroll
 * - Maximum 10 patients
 * - Click navigates to patient chronicle
 */
const RecentPatientsSection = ({
  patients = [],
  isLoading = false,
  className,
  showHeader = true,
}) => {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <section className={cn("space-y-3", className)}>
        {showHeader && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <h2 className="font-heading text-sm font-medium">Recent</h2>
          </div>
        )}
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-40 flex-shrink-0 rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  if (!patients || patients.length === 0) {
    return null; // Don't show section if no recent patients
  }

  const handlePatientClick = (patient) => {
    const patientId = getPatientId(patient);
    if (patientId) {
      navigate(`/patients/${patientId}`);
    }
  };

  return (
    <section className={cn("space-y-3", className)}>
      {showHeader && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="h-4 w-4" />
          <h2 className="font-heading text-sm font-medium">Recent</h2>
          <span className="text-xs">({patients.length})</span>
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin snap-x snap-mandatory">
        {patients.map((recentEntry, index) => {
          const patient = recentEntry.patient_profile_details || recentEntry;
          return (
            <RecentPatientCard
              key={getPatientId(patient) || index}
              patient={patient}
              onClick={() => handlePatientClick(patient)}
            />
          );
        })}
      </div>
    </section>
  );
};

/**
 * RecentPatientCard - Compact patient card for horizontal scroll
 */
const RecentPatientCard = ({ patient, onClick }) => {
  const name = getDisplayName(patient);
  const mrn = getPatientMRN(patient);
  const ward = getPatientWard(patient);
  const admissionStatus = getAdmissionStatus(patient, ward);
  const age = getPatientAge(patient);
  const gender = getPatientGender(patient);
  const showWard = admissionStatus === "Inpatient" && ward && ward !== "Admitted (No Bed)";

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-shrink-0 w-44 snap-start",
        "bg-card hover:bg-accent/50 border border-border rounded-xl p-3",
        "text-left transition-all duration-200",
        "hover:shadow-md hover:border-primary/20",
        "focus:outline-none focus:ring-2 focus:ring-primary/20",
        "group"
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex-1 min-w-0">
          <p className="font-display text-sm font-medium text-foreground truncate">
            {name}
          </p>
          <p className="font-mono text-xs text-muted-foreground mt-0.5">
            {mrn}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
      </div>

      <div className="flex items-center gap-2 mt-2">
        {age && gender && (
          <span className="text-xs text-muted-foreground">
            {age}y {gender}
          </span>
        )}
        <span
          className={cn(
            "text-xs px-1.5 py-0.5 rounded",
            admissionStatus === "Inpatient" && "bg-green-100 text-green-800",
            admissionStatus === "Waiting List" && "bg-yellow-100 text-yellow-800",
            admissionStatus === "Not Admitted" && "bg-gray-100 text-gray-800"
          )}
        >
          {admissionStatus}
        </span>
        {showWard && (
          <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded truncate max-w-[90px]">
            {ward}
          </span>
        )}
      </div>
    </button>
  );
};

// Helper functions (matching PatientChronicleCard patterns)
const getPatientId = (patient) => {
  if (patient?.id) return patient.id;
  if (patient?.patient_profile) return patient.patient_profile;
  if (patient?.local_data?.id) return patient.local_data.id;
  return null;
};

const getDisplayName = (patient) => {
  if (patient?.name) return patient.name;
  if (patient?.user_details) {
    const { first_name, last_name } = patient.user_details;
    return `${first_name || ''} ${last_name || ''}`.trim() || "Unknown";
  }
  if (patient?.local_data?.user_details) {
    return `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim() || "Unknown";
  }
  return "Unknown";
};

const getPatientMRN = (patient) => {
  return patient?.medical_record_number ||
    patient?.mrn ||
    patient?.local_data?.medical_record_number ||
    "No MRN";
};

const getPatientWard = (patient) => {
  return patient?.current_ward ||
    patient?.local_data?.current_ward ||
    null;
};

const getAdmissionStatus = (patient, wardOverride) => {
  const status = patient?.admission_status;
  if (status === "waiting") return "Waiting List";
  if (status === "admitted") return "Inpatient";
  if (status) return status;

  const ward = wardOverride || getPatientWard(patient);
  if (ward === "Waiting List" || ward === "Admitted (No Bed)") return "Waiting List";
  if (ward) return "Inpatient";
  return "Not Admitted";
};

const getPatientAge = (patient) => {
  const dob = patient?.date_of_birth ||
    patient?.user_details?.date_of_birth ||
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
  const gender = patient?.gender ||
    patient?.user_details?.gender ||
    patient?.local_data?.user_details?.gender;

  if (gender === 'M' || gender === 'male') return 'M';
  if (gender === 'F' || gender === 'female') return 'F';
  return null;
};

export default RecentPatientsSection;
