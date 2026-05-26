import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import FileWarning from 'lucide-react/dist/esm/icons/file-warning.js';
import Droplet from 'lucide-react/dist/esm/icons/droplet.js';
import ArrowDownCircle from 'lucide-react/dist/esm/icons/circle-arrow-down.js';
import ArrowUpCircle from 'lucide-react/dist/esm/icons/circle-arrow-up.js';
import BarChart3 from 'lucide-react/dist/esm/icons/chart-column.js';
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { useTodayFluidBalance } from "@/features/nursing/hooks";
import { InvoiceChronicleCard } from "@/components/billing";
import { PatientCareTeamCompact } from "@/components/chronicle/PatientCareTeamCard";

const EMPTY_ARRAY = Object.freeze([]);

/**
 * ClinicalSummarySidebar - Always-visible patient context panel
 *
 * Displays critical patient information:
 * - Recent vitals snapshot
 * - Active problems (with severity indicators)
 * - Current medications
 * - Fluid balance (admitted patients)
 */
const ClinicalSummarySidebar = ({
  patient,
  allergies = EMPTY_ARRAY,
  problems = EMPTY_ARRAY,
  medications = EMPTY_ARRAY,
  vitals = EMPTY_ARRAY,
  labResults = EMPTY_ARRAY,
  encounter,
  onViewVitalsTrends,
  onViewFluidTrends,
  className
}) => {
  const normalizedAllergies = Array.isArray(allergies) ? allergies : [];
  const normalizedProblems = normalizeProblems(problems);
  // Check if patient is admitted (has active admission)
  // Check multiple fields for backward compatibility
  const isAdmitted = patient?.local_data?.current_admission_id ||
    patient?.current_admission_id ||
    patient?.local_data?.admission_status === 'admitted' ||
    patient?.admission_status === 'admitted' ||
    // Fallback: check if current_ward_id exists (means patient has a bed)
    patient?.local_data?.current_ward_id ||
    patient?.current_ward_id;

  const patientId = patient?.local_data?.id || patient?.id;

  return (
    <aside className={cn(
      "w-80 bg-background border-r border-border p-6 space-y-6",
      "overflow-y-auto h-screen sticky top-0",
      "chronicle-scrollbar",
      className
    )}>
      {/* Section: Care Team */}
      {encounter && (
        <>
          <PatientCareTeamCompact encounter={encounter} />
          <div className="divider-gradient" />
        </>
      )}

      {/* Section: Allergies */}
      <AllergiesSection allergies={normalizedAllergies} />

      {/* Divider */}
      <div className="divider-gradient" />

      {/* Section: Recent Vitals */}
      <VitalsSection vitals={vitals} onViewTrends={onViewVitalsTrends} />

      {/* Divider */}
      <div className="divider-gradient" />

      {/* Section: Active Problems */}
      <ProblemsSection problems={normalizedProblems} />

      {/* Divider */}
      <div className="divider-gradient" />

      {/* Section: Current Medications */}
      <MedicationsSection medications={medications} />

      {/* Section: Fluid Balance - Only for admitted patients */}
      {isAdmitted && patientId && (
        <>
          <div className="divider-gradient" />
          <FluidBalanceSection patientId={patientId} onViewTrends={onViewFluidTrends} />
        </>
      )}

      {/* Section: Recent Labs */}
      <div className="divider-gradient" />
      <LabResultsSection results={labResults} />

      {/* Section: Billing Summary */}
      {patientId && (
        <>
          <div className="divider-gradient" />
          <InvoiceChronicleCard patientId={patientId} />
        </>
      )}
    </aside>
  );
};

function hasDisplayValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function getProblemName(problem) {
  if (typeof problem === 'string') {
    return problem;
  }

  return problem?.name
    || problem?.label
    || problem?.title
    || problem?.description
    || problem?.diagnosis
    || problem?.condition
    || null;
}

function normalizeProblems(problems = EMPTY_ARRAY) {
  if (!Array.isArray(problems)) {
    return [];
  }

  return problems
    .flatMap((problem) => {
      const name = getProblemName(problem);
      if (!hasDisplayValue(name)) {
        return [];
      }

      const normalizedProblem = typeof problem === 'string'
        ? { id: problem, name }
        : { ...problem, name };

      return [normalizedProblem];
    });
}

function getMedicationName(medication) {
  return medication?.name
    || medication?.medication
    || medication?.medication_name
    || medication?.medication_display
    || null;
}

function getAllergyName(allergy) {
  if (typeof allergy === 'string') {
    return allergy;
  }

  return allergy?.name
    || allergy?.allergen_name
    || allergy?.substance
    || allergy?.allergen
    || null;
}

function getAllergySeverity(allergy) {
  return typeof allergy === 'object' && allergy !== null ? allergy.severity : null;
}

function getStableClinicalItemKey(prefix, item, index, fallbackParts = EMPTY_ARRAY) {
  if (typeof item === 'object' && item !== null) {
    const stableId = item.id
      || item.uuid
      || item.allergy_id
      || item.patient_allergy_id
      || item.problem_id;

    if (hasDisplayValue(stableId)) {
      return `${prefix}-${stableId}`;
    }
  }

  const fallbackSegments = [];
  for (const part of fallbackParts) {
    if (hasDisplayValue(part)) {
      fallbackSegments.push(String(part).trim());
    }
  }
  const fallback = fallbackSegments.join('-');

  return `${prefix}-${fallback || 'item'}-${index}`;
}

/**
 * ProblemsSection - Active problems list with severity indicators
 */
const ProblemsSection = ({ problems }) => {
  const normalizedProblems = normalizeProblems(problems);
  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
      case 'high':
        return 'bg-destructive';
      case 'medium':
      case 'moderate':
        return 'bg-primary';
      default:
        return 'bg-muted-foreground';
    }
  };

  const getSeverityLabel = (problem) => {
    if (problem.is_primary) return 'Primary';
    if (problem.is_chronic) return 'Chronic';
    if (problem.duration) return problem.duration;
    return null;
  };

  return (
    <section>
      <header className="flex items-center justify-between mb-4">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Active Problems
        </h3>
        <span className="font-mono text-xs text-primary">
          {normalizedProblems.length}
        </span>
      </header>

      {normalizedProblems.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active problems</p>
      ) : (
        <ul className="space-y-2">
          {normalizedProblems.map((problem) => (
            <li
              key={problem.id || problem.name}
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg",
                "bg-card/50 border border-border",
                "hover:border-border/80 transition-colors cursor-pointer"
              )}
            >
              <div className={cn(
                "w-2 h-2 rounded-full mt-1.5 shrink-0",
                getSeverityColor(problem.severity)
              )} />
              <div className="min-w-0 flex-1">
                <p className="text-foreground/90 text-sm font-medium truncate">
                  {problem.name}
                </p>
                {getSeverityLabel(problem) && (
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {getSeverityLabel(problem)}
                    {problem.onset_date && ` · Since ${problem.onset_date}`}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

/**
 * MedicationsSection - Current medications list
 */
const MedicationsSection = ({ medications, maxVisible = 5 }) => {
  const normalizedMedications = Array.isArray(medications)
    ? medications.filter((medication) => hasDisplayValue(getMedicationName(medication)))
    : [];
  const visibleMeds = normalizedMedications.slice(0, maxVisible);
  const remainingCount = normalizedMedications.length - maxVisible;

  return (
    <section>
      <header className="flex items-center justify-between mb-4">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Active Medications
        </h3>
        <span className="font-mono text-xs text-primary">
          {normalizedMedications.length}
        </span>
      </header>

      {normalizedMedications.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active medications</p>
      ) : (
        <ul className="space-y-1">
          {visibleMeds.map((med) => {
            const medicationName = getMedicationName(med);
            const dose = med.dose || med.dosage;
            const frequency = med.frequency || med.frequency_display;

            return (
              <li
                key={med.id || medicationName}
                className={cn(
                  "px-3 py-2 rounded-lg text-sm",
                  "text-foreground/80",
                  "hover:bg-card/50 transition-colors cursor-pointer",
                  "flex items-center gap-2"
                )}
              >
                <Pill className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate">
                  {medicationName}
                  {dose && ` ${dose}`}
                  {frequency && ` ${frequency}`}
                </span>
              </li>
            );
          })}
          {remainingCount > 0 && (
            <li className={cn(
              "px-3 py-2 text-sm font-mono cursor-pointer",
              "text-primary hover:text-primary/80 transition-colors",
              "flex items-center gap-1"
            )}>
              +{remainingCount} more
              <ChevronRight className="h-3 w-3" />
            </li>
          )}
        </ul>
      )}
    </section>
  );
};

/**
 * AllergiesSection - High visibility allergies display
 */
const AllergiesSection = ({ allergies }) => {
  if (!allergies || allergies.length === 0) {
    return (
      <section className="p-4 rounded-xl bg-muted/30 border border-border">
        <header className="flex items-center gap-2 mb-2">
          <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center">
            <FileWarning className="h-3 w-3 text-muted-foreground" />
          </div>
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Allergies
          </h3>
        </header>
        <p className="text-sm text-muted-foreground">NKDA (No Known Drug Allergies)</p>
      </section>
    );
  }

  return (
    <section className="p-4 rounded-xl bg-destructive/5 border border-destructive/20">
      <header className="flex items-center gap-2 mb-3">
        <div className="w-5 h-5 rounded-full bg-destructive/20 flex items-center justify-center">
          <AlertTriangle className="h-3 w-3 text-destructive" />
        </div>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-destructive">
          Allergies
        </h3>
      </header>

      <div className="flex flex-wrap gap-2">
        {allergies.map((allergy, index) => {
          const allergyName = getAllergyName(allergy);
          const severity = getAllergySeverity(allergy);

          return (
            <span
              key={getStableClinicalItemKey('allergy', allergy, index, [allergyName, severity || 'allergy'])}
              className={cn(
                "px-2 py-1 rounded font-mono text-xs border",
                severity === 'severe'
                  ? "bg-destructive/20 text-destructive border-destructive/40"
                  : "bg-destructive/10 text-destructive/90 border-destructive/30"
              )}
            >
              {allergyName}
              {severity === 'severe' && ' ⚠'}
            </span>
          );
        })}
      </div>
    </section>
  );
};

function formatSidebarTimestamp(timestamp, fallback = 'Recent') {
  if (!timestamp) {
    return fallback;
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getAbnormalDirectionSymbol(direction) {
  if (String(direction || '').includes('high')) {
    return '↑';
  }
  if (String(direction || '').includes('low')) {
    return '↓';
  }
  return '!';
}

/**
 * VitalsSection - Recent vital signs with abnormal highlighting
 */
const VitalsSection = ({ vitals = EMPTY_ARRAY, maxVisible = 6, onViewTrends }) => {
  const visibleVitals = Array.isArray(vitals) ? vitals.slice(0, maxVisible) : [];

  return (
    <section>
      <header className="mb-4 space-y-1">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Recent Vitals
          </h3>
          {onViewTrends ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onViewTrends}
              className="h-6 px-2 font-mono text-[10px]"
            >
              <BarChart3 className="mr-1 h-3 w-3" />
              Trends
            </Button>
          ) : null}
        </div>
        <time className="block font-mono text-[10px] text-muted-foreground/70">
          {visibleVitals.length ? formatSidebarTimestamp(visibleVitals[0]?.timestamp) : 'No vitals'}
        </time>
      </header>

      {visibleVitals.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {visibleVitals.map((vital) => (
            <div
              key={vital.id || `${vital.name}-${vital.value}-${vital.timestamp || 'vital'}`}
              className={cn(
                "p-3 rounded-lg border",
                vital.is_abnormal
                  ? "bg-primary/5 border-primary/30"
                  : "bg-card/50 border-border"
              )}
            >
              <div className={cn(
                "font-mono text-lg",
                vital.is_abnormal ? "text-primary" : "text-foreground"
              )}>
                {vital.value}
                {vital.is_abnormal && (
                  <span className="text-xs ml-1">
                    {getAbnormalDirectionSymbol(vital.abnormal_direction)}
                  </span>
                )}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">
                {vital.name} {vital.unit && `(${vital.unit})`}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No vitals recorded yet.</p>
      )}

    </section>
  );
};

/**
 * LabResultsSection - Recent lab results with abnormal highlighting
 */
const LabResultsSection = ({ results = EMPTY_ARRAY, maxVisible = 4 }) => {
  const visibleResults = Array.isArray(results) ? results.slice(0, maxVisible) : [];

  return (
    <section>
      <header className="mb-4 space-y-1">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Recent Labs
          </h3>
          <span className="font-mono text-xs text-primary">
            {Array.isArray(results) ? results.length : 0}
          </span>
        </div>
        <time className="block font-mono text-[10px] text-muted-foreground/70">
          {visibleResults.length ? formatSidebarTimestamp(visibleResults[0]?.timestamp) : 'No labs'}
        </time>
      </header>

      {visibleResults.length > 0 ? (
        <ul className="space-y-2">
          {visibleResults.map((result) => (
            <li
              key={result.id || `${result.name}-${result.value}-${result.timestamp || 'lab'}`}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
                result.is_abnormal
                  ? "bg-amber-500/5 border-amber-500/30"
                  : "bg-card/50 border-border"
              )}
            >
              <span className="min-w-0 truncate text-sm text-foreground/80">
                {result.name}
              </span>
              <span className={cn(
                "shrink-0 font-mono text-xs",
                result.is_abnormal ? "text-amber-600" : "text-muted-foreground"
              )}>
                {result.value ?? 'Resulted'}
                {result.unit ? ` ${result.unit}` : ''}
                {result.is_abnormal && (
                  <span className="ml-1">{getAbnormalDirectionSymbol(result.abnormal_direction)}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No recent labs recorded.</p>
      )}
    </section>
  );
};

/**
 * FluidBalanceSection - Today's fluid balance for admitted patients
 */
const FluidBalanceSection = ({ patientId, onViewTrends }) => {
  const { data: fluidData, isLoading } = useTodayFluidBalance(patientId);

  if (isLoading) {
    return (
      <section>
        <header className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Fluid Balance
            </h3>
            {onViewTrends ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onViewTrends}
                className="h-6 px-2 font-mono text-[10px]"
              >
                <BarChart3 className="mr-1 h-3 w-3" />
                Trends
              </Button>
            ) : null}
          </div>
        </header>
        <div className="animate-pulse space-y-2">
          <div className="h-16 bg-muted rounded-lg" />
        </div>
      </section>
    );
  }

  const intake = fluidData?.total_intake || 0;
  const output = fluidData?.total_output || 0;
  const balance = fluidData?.balance || (intake - output);

  return (
    <section>
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Fluid Balance (Today)
          </h3>
          {onViewTrends ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onViewTrends}
              className="h-6 px-2 font-mono text-[10px]"
            >
              <BarChart3 className="mr-1 h-3 w-3" />
              Trends
            </Button>
          ) : null}
        </div>
        <Droplet className="h-3.5 w-3.5 text-sky-500" />
      </header>

      <div className="grid grid-cols-3 gap-2">
        {/* Intake */}
        <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20">
          <div className="flex items-center gap-1 mb-1">
            <ArrowDownCircle className="h-3 w-3 text-sky-500" />
            <span className="font-mono text-[10px] text-sky-600">IN</span>
          </div>
          <div className="font-mono text-sm font-medium text-sky-600">
            {intake}
            <span className="text-[10px] ml-0.5">ml</span>
          </div>
        </div>

        {/* Output */}
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-center gap-1 mb-1">
            <ArrowUpCircle className="h-3 w-3 text-amber-500" />
            <span className="font-mono text-[10px] text-amber-600">OUT</span>
          </div>
          <div className="font-mono text-sm font-medium text-amber-600">
            {output}
            <span className="text-[10px] ml-0.5">ml</span>
          </div>
        </div>

        {/* Balance */}
        <div className={cn(
          "p-3 rounded-lg border",
          balance > 0 && "bg-emerald-500/10 border-emerald-500/20",
          balance < 0 && "bg-rose-500/10 border-rose-500/20",
          balance === 0 && "bg-muted border-border"
        )}>
          <div className="flex items-center gap-1 mb-1">
            <Droplet className={cn(
              "h-3 w-3",
              balance > 0 && "text-emerald-500",
              balance < 0 && "text-rose-500",
              balance === 0 && "text-muted-foreground"
            )} />
            <span className={cn(
              "font-mono text-[10px]",
              balance > 0 && "text-emerald-600",
              balance < 0 && "text-rose-600",
              balance === 0 && "text-muted-foreground"
            )}>BAL</span>
          </div>
          <div className={cn(
            "font-mono text-sm font-medium",
            balance > 0 && "text-emerald-600",
            balance < 0 && "text-rose-600",
            balance === 0 && "text-muted-foreground"
          )}>
            {balance > 0 ? '+' : ''}{balance}
            <span className="text-[10px] ml-0.5">ml</span>
          </div>
        </div>
      </div>

      {/* No data message */}
      {intake === 0 && output === 0 && (
        <p className="text-xs text-muted-foreground mt-2 text-center">
          No fluid entries recorded today
        </p>
      )}
    </section>
  );
};

/**
 * MiniClinicalSummary - Compact version for inline use
 */
const MiniClinicalSummary = ({ allergies = EMPTY_ARRAY, problems = EMPTY_ARRAY }) => {
  const topProblems = problems.slice(0, 3);

  return (
    <div className="space-y-3 p-4 rounded-xl bg-card/30 border border-border">
      {/* Allergies - Always visible */}
      {allergies.length > 0 ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-wider text-destructive">
            Allergies:
          </span>
          {allergies.map((allergy, index) => {
            const allergyName = getAllergyName(allergy);

            return (
              <span
                key={getStableClinicalItemKey('allergy-mini', allergy, index, [allergyName])}
                className="badge-chronicle-rose text-[10px]"
              >
                {allergyName}
              </span>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            NKDA
          </span>
        </div>
      )}

      {/* Top Problems */}
      {topProblems.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Dx:
          </span>
          {topProblems.map((problem, index) => (
            <span
              key={typeof problem === 'string' ? problem : problem.id || problem.name}
              className="text-xs text-foreground/80"
            >
              {typeof problem === 'string' ? problem : problem.name}
              {index < topProblems.length - 1 && ','}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default ClinicalSummarySidebar;
export {
  ClinicalSummarySidebar,
  ProblemsSection,
  MedicationsSection,
  AllergiesSection,
  VitalsSection,
  LabResultsSection,
  FluidBalanceSection,
  MiniClinicalSummary
};
