import { cn } from "@/lib/utils";

const SECTION_ORDER = [
  'subjective', 'objective', 'assessment', 'plan',
  'chief_complaint', 'chiefComplaint',
  'history_of_present_illness', 'historyOfPresentIllness',
  'review_of_systems', 'reviewOfSystems',
  'current_medications', 'currentMedications',
  'allergies', 'social_history', 'socialHistory',
  'family_history', 'familyHistory',
  'vital_signs', 'vitalSigns',
  'physical_exam', 'physicalExam',
  'investigations', 'investigations_results',
  'primary_diagnosis', 'primaryDiagnosis',
  'differential_diagnoses', 'differentialDiagnoses',
  'secondary_findings', 'secondaryFindings',
  'clinical_reasoning', 'clinicalReasoning',
  'severity',
  'medications',
  'non_pharmacological', 'nonPharmacological',
  'patient_education', 'patientEducation',
  'follow_up', 'followUp',
  'referrals', 'disposition',
  'history', 'examination', 'diagnosis', 'treatment', 'notes', 'findings', 'recommendations',
];

const sortClinicalEntries = (entries) => [...entries].sort((a, b) => {
  const indexA = SECTION_ORDER.indexOf(a[0].toLowerCase());
  const indexB = SECTION_ORDER.indexOf(b[0].toLowerCase());

  if (indexA !== -1 && indexB !== -1) return indexA - indexB;
  if (indexA !== -1) return -1;
  if (indexB !== -1) return 1;
  return 0;
});

const formatLabel = (label) => label
  .replace(/_/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/\b\w/g, (character) => character.toUpperCase());

const getSectionColor = (label) => {
  const lowerLabel = label.toLowerCase();

  if (['subjective', 'chief_complaint', 'history', 'history_of_present_illness'].includes(lowerLabel)) {
    return 'border-blue-500/50 dark:border-blue-400/50';
  }
  if (['objective', 'examination', 'physical_exam', 'vitals', 'findings'].includes(lowerLabel)) {
    return 'border-green-500/50 dark:border-green-400/50';
  }
  if (['assessment', 'diagnosis'].includes(lowerLabel)) {
    return 'border-amber-500/50 dark:border-amber-400/50';
  }
  if (['plan', 'treatment', 'medications'].includes(lowerLabel)) {
    return 'border-purple-500/50 dark:border-purple-400/50';
  }

  return 'border-border';
};

const GenericDataRenderer = ({ data, depth = 0 }) => {
  if (data === null || data === undefined) {
    return null;
  }

  if (typeof data === 'string') {
    return (
      <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
        {data}
      </p>
    );
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return null;
    }

    const hasComplexItems = data.some((item) => typeof item === 'object' && item !== null);
    if (!hasComplexItems) {
      return (
        <ul className="list-disc list-inside text-sm text-foreground/80 space-y-1">
          {data.map((item, index) => (
            <li key={`${String(item)}-${index}`}>{String(item)}</li>
          ))}
        </ul>
      );
    }

    return (
      <div className="space-y-3">
        {data.map((item, index) => (
          <div key={index} className="pl-3 border-l-2 border-border/50">
            <GenericDataRenderer data={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data);
    if (entries.length === 0) {
      return null;
    }

    return (
      <div className={cn("space-y-4", depth > 0 && "space-y-3")}>
        {sortClinicalEntries(entries).map(([label, value]) => {
          if (value === null || value === undefined) {
            return null;
          }
          if (typeof value === 'string' && value.trim() === '') {
            return null;
          }
          if (Array.isArray(value) && value.length === 0) {
            return null;
          }
          if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
            return null;
          }

          return (
            <DataSection
              key={label}
              depth={depth}
              label={label}
              value={value}
            />
          );
        })}
      </div>
    );
  }

  return (
    <span className="text-sm text-foreground/80">{String(data)}</span>
  );
};

const DataSection = ({ label, value, depth }) => {
  const lowerLabel = label.toLowerCase();
  const isMajorSection = depth === 0 && [
    'subjective',
    'objective',
    'assessment',
    'plan',
    'history',
    'examination',
    'diagnosis',
    'treatment',
    'notes',
    'findings',
    'chief_complaint',
    'history_of_present_illness',
    'review_of_systems',
    'physical_exam',
    'medications',
    'allergies',
    'vitals',
  ].includes(lowerLabel);

  return (
    <div
      className={cn(
        "border-l-2 pl-4",
        isMajorSection ? getSectionColor(label) : 'border-border/50',
        isMajorSection && "pb-2"
      )}
    >
      <h5
        className={cn(
          "font-mono text-xs uppercase tracking-wider mb-2",
          isMajorSection ? "text-foreground/70 font-semibold" : "text-muted-foreground/70"
        )}
      >
        {formatLabel(label)}
      </h5>
      <div className={cn(depth > 0 && "text-sm")}>
        <GenericDataRenderer data={value} depth={depth + 1} />
      </div>
    </div>
  );
};

const ChronicleNoteBody = ({ content, data, className }) => (
  <div className={cn("space-y-4", className)}>
    {typeof content === 'string' && content.trim() && (
      <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
        {content}
      </div>
    )}
    {data !== null && data !== undefined && (
      <GenericDataRenderer data={data} />
    )}
  </div>
);

export default ChronicleNoteBody;
