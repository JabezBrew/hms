import { useNavigate } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { buildPatientChronicleCardModel } from './PatientChronicleCardModel';
import {
  PatientChronicleFooter,
  PatientChronicleHeader,
  PatientChronicleStatusRibbon,
  PatientChronicleSynopsis,
  PatientChronicleVitals,
} from './PatientChronicleCardSections';

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
  className,
}) => {
  const navigate = useNavigate();
  const card = buildPatientChronicleCardModel(patient);

  const handleViewRecord = () => {
    if (card.patientId) {
      onPrefetchPatient?.(card.patientId, 'navigation');
      navigate(`/patients/${card.patientId}`);
    }
  };

  const handleIntentPrefetch = () => {
    if (card.patientId) {
      onPrefetchPatient?.(card.patientId, 'hover');
    }
  };

  const handleStartRound = (event) => {
    event.stopPropagation();
    onStartRound?.(patient);
  };

  const handleStartConsultation = (event) => {
    event.stopPropagation();
    onStartConsultation?.(patient);
  };

  const handleAddToMyPatients = (event) => {
    event.stopPropagation();
    onAddToMyPatients?.(card.patientId);
  };

  const handleRemoveFromMyPatients = (event) => {
    event.stopPropagation();
    onRemoveFromMyPatients?.(card.patientId);
  };

  const handleTogglePin = (event) => {
    event.stopPropagation();
    if (patient?._listEntryId) {
      onTogglePin?.(patient._listEntryId);
    }
  };

  return (
    <div
      onPointerEnter={handleIntentPrefetch}
      onFocus={handleIntentPrefetch}
      className={cn(
        'group relative bg-card/50 backdrop-blur border border-border',
        'rounded-xl sm:rounded-2xl p-4 sm:p-6',
        'hover:border-primary/30 transition-all duration-500',
        'hover:shadow-[0_0_40px_-12px_var(--chronicle-amber)]',
        'animate-chronicle-enter',
        className
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <button
        type="button"
        className="absolute inset-0 z-0 rounded-xl sm:rounded-2xl cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={handleViewRecord}
        aria-label={`View patient ${card.displayName}, ${card.mrn}`}
      />

      <div className="relative z-10 pointer-events-none">
        <PatientChronicleStatusRibbon status={card.status} />
        <PatientChronicleHeader
          displayName={card.displayName}
          demographics={card.demographics}
          status={card.status}
          allergies={card.allergies}
        />
        <PatientChronicleSynopsis
          primaryDx={card.primaryDx}
          admissionDays={card.admissionDays}
          ward={card.ward}
          attending={card.attending}
        />
        <PatientChronicleVitals vitals={card.vitals} />
        <PatientChronicleFooter
          card={card}
          actions={{
            showMyPatientsActions,
            isInMyPatients,
            addToMyPatients: onAddToMyPatients ? handleAddToMyPatients : null,
            removeFromMyPatients: onRemoveFromMyPatients ? handleRemoveFromMyPatients : null,
            togglePin: onTogglePin ? handleTogglePin : null,
            viewRecord: handleViewRecord,
            startRound: onStartRound ? handleStartRound : null,
            startConsultation: onStartConsultation ? handleStartConsultation : null,
          }}
        />
      </div>
    </div>
  );
};

export default PatientChronicleCard;
export { PatientChronicleCard };
