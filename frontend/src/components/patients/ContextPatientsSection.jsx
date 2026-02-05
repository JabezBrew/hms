import Users from 'lucide-react/dist/esm/icons/users.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { PatientChronicleCard } from "@/components/chronicle";

/**
 * ContextPatientsSection - Role-specific patient list
 *
 * Displays patients relevant to the user's current work context:
 * - Nurses: Ward patients
 * - Doctors: Today's appointments + inpatients
 * - Receptionists: Today's scheduled patients
 * - Others: Empty with search guidance
 */
const ContextPatientsSection = ({
  data,
  isLoading = false,
  onStartRound,
  onStartConsultation,
  showMyPatientsActions = false,
  onAddToMyPatients,
  onPrefetchPatient,
  className,
}) => {
  if (isLoading) {
    return (
      <section className={cn("space-y-4", className)}>
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  const { context, context_label, patients = [], total = 0 } = data || {};

  // Get context-specific icon
  const ContextIcon = getContextIcon(context);

  // No context or empty patients - show search guidance
  if (context === 'none' || !patients || patients.length === 0) {
    return (
      <section className={cn("space-y-4", className)}>
        <EmptyContextState context={context} />
      </section>
    );
  }

  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-foreground">
          <ContextIcon className="h-5 w-5 text-primary" />
          <h2 className="font-heading text-base font-medium">{context_label}</h2>
          <span className="text-sm text-muted-foreground">({total})</span>
        </div>

        {data?.breakdown && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {data.breakdown.inpatients > 0 && (
              <span className="flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {data.breakdown.inpatients} inpatients
              </span>
            )}
            {data.breakdown.appointments > 0 && (
              <span className="flex items-center gap-1">
                <ClipboardList className="h-3 w-3" />
                {data.breakdown.appointments} appointments
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {patients.map((patient, index) => (
          <PatientChronicleCard
            key={patient.id || index}
            patient={transformContextPatient(patient)}
            index={index}
            onStartRound={onStartRound}
            onStartConsultation={onStartConsultation}
            showMyPatientsActions={showMyPatientsActions}
            onAddToMyPatients={onAddToMyPatients}
            onPrefetchPatient={onPrefetchPatient}
          />
        ))}
      </div>
    </section>
  );
};

/**
 * EmptyContextState - Shown when no context patients available
 */
const EmptyContextState = ({ context }) => {
  const getMessage = () => {
    switch (context) {
      case 'ward':
        return {
          title: 'No ward patients',
          description: 'No patients are currently admitted to your ward.',
        };
      case 'doctor':
        return {
          title: 'No scheduled patients',
          description: 'You have no appointments or inpatients today.',
        };
      case 'reception':
        return {
          title: 'No scheduled arrivals',
          description: 'No patients are scheduled for today.',
        };
      default:
        return {
          title: 'Search for patients',
          description: 'Use the search bar above to find patients by name, MRN, or phone number.',
        };
    }
  };

  const { title, description } = getMessage();

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
        <Search className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-display text-lg text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
    </div>
  );
};

/**
 * Get icon based on context type
 */
const getContextIcon = (context) => {
  switch (context) {
    case 'ward':
      return Building2;
    case 'doctor':
      return Stethoscope;
    case 'reception':
      return ClipboardList;
    default:
      return Users;
  }
};

/**
 * Transform context patient data to match PatientChronicleCard expected format
 */
const transformContextPatient = (patient) => {
  return {
    id: patient.id,
    user_details: {
      first_name: patient.name?.split(' ')[0] || '',
      last_name: patient.name?.split(' ').slice(1).join(' ') || '',
      gender: patient.gender,
      date_of_birth: patient.date_of_birth,
    },
    medical_record_number: patient.mrn,
    current_ward: patient.current_ward,
    current_ward_id: patient.current_ward_id,
    // Additional context-specific fields
    bed_number: patient.bed_number,
    admission_date: patient.admission_date,
    context_type: patient.context_type,
  };
};

export default ContextPatientsSection;
