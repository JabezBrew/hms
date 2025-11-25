import { cn } from "@/lib/utils";
import { AlertTriangle, ChevronRight, Pill, Activity, FileWarning } from "lucide-react";

/**
 * ClinicalSummarySidebar - Always-visible patient context panel
 *
 * Displays critical patient information:
 * - Active problems (with severity indicators)
 * - Current medications
 * - Allergies (high visibility)
 * - Recent lab results (with abnormal highlighting)
 */
const ClinicalSummarySidebar = ({
  patient,
  problems = [],
  medications = [],
  allergies = [],
  labResults = [],
  className
}) => {
  return (
    <aside className={cn(
      "w-80 bg-background border-r border-border p-6 space-y-6",
      "overflow-y-auto h-screen sticky top-0",
      "chronicle-scrollbar",
      className
    )}>
      {/* Section: Active Problems */}
      <ProblemsSection problems={problems} />

      {/* Divider */}
      <div className="divider-gradient" />

      {/* Section: Current Medications */}
      <MedicationsSection medications={medications} />

      {/* Divider */}
      <div className="divider-gradient" />

      {/* Section: Allergies - High Visibility */}
      <AllergiesSection allergies={allergies} />

      {/* Section: Recent Labs */}
      <LabResultsSection results={labResults} />
    </aside>
  );
};

/**
 * ProblemsSection - Active problems list with severity indicators
 */
const ProblemsSection = ({ problems }) => {
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
          {problems.length}
        </span>
      </header>

      {problems.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active problems</p>
      ) : (
        <ul className="space-y-2">
          {problems.map((problem, i) => (
            <li
              key={problem.id || i}
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
                  {problem.name || problem.description}
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
  const visibleMeds = medications.slice(0, maxVisible);
  const remainingCount = medications.length - maxVisible;

  return (
    <section>
      <header className="flex items-center justify-between mb-4">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Active Medications
        </h3>
        <span className="font-mono text-xs text-primary">
          {medications.length}
        </span>
      </header>

      {medications.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active medications</p>
      ) : (
        <ul className="space-y-1">
          {visibleMeds.map((med, i) => (
            <li
              key={med.id || i}
              className={cn(
                "px-3 py-2 rounded-lg text-sm",
                "text-foreground/80",
                "hover:bg-card/50 transition-colors cursor-pointer",
                "flex items-center gap-2"
              )}
            >
              <Pill className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="truncate">
                {med.name}
                {med.dose && ` ${med.dose}`}
                {med.frequency && ` ${med.frequency}`}
              </span>
            </li>
          ))}
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
        {allergies.map((allergy, i) => {
          const allergyName = typeof allergy === 'string' ? allergy : allergy.name;
          const severity = typeof allergy === 'object' ? allergy.severity : null;

          return (
            <span
              key={i}
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

/**
 * LabResultsSection - Recent lab results with abnormal highlighting
 */
const LabResultsSection = ({ results, maxVisible = 4 }) => {
  const visibleResults = results.slice(0, maxVisible);

  if (!results || results.length === 0) {
    return null;
  }

  // Get the most recent timestamp
  const latestDate = results[0]?.timestamp
    ? new Date(results[0].timestamp).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : 'Recent';

  return (
    <section>
      <header className="flex items-center justify-between mb-4">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Recent Labs
        </h3>
        <time className="font-mono text-xs text-muted-foreground/70">
          {latestDate}
        </time>
      </header>

      <div className="grid grid-cols-2 gap-2">
        {visibleResults.map((result, i) => (
          <div
            key={result.id || i}
            className={cn(
              "p-3 rounded-lg border",
              result.is_abnormal
                ? "bg-primary/5 border-primary/30"
                : "bg-card/50 border-border"
            )}
          >
            <div className={cn(
              "font-mono text-lg",
              result.is_abnormal ? "text-primary" : "text-foreground"
            )}>
              {result.value}
              {result.is_abnormal && (
                <span className="text-xs ml-1">
                  {result.abnormal_direction === 'high' ? '↑' : '↓'}
                </span>
              )}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {result.name} {result.unit && `(${result.unit})`}
            </div>
          </div>
        ))}
      </div>

      {results.length > maxVisible && (
        <button className={cn(
          "mt-3 w-full py-2 text-center font-mono text-xs",
          "text-primary hover:text-primary/80 transition-colors",
          "flex items-center justify-center gap-1"
        )}>
          View all {results.length} results
          <ChevronRight className="h-3 w-3" />
        </button>
      )}
    </section>
  );
};

/**
 * MiniClinicalSummary - Compact version for inline use
 */
const MiniClinicalSummary = ({ patient, allergies = [], problems = [] }) => {
  const topProblems = problems.slice(0, 3);

  return (
    <div className="space-y-3 p-4 rounded-xl bg-card/30 border border-border">
      {/* Allergies - Always visible */}
      {allergies.length > 0 ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-wider text-destructive">
            Allergies:
          </span>
          {allergies.map((a, i) => (
            <span key={i} className="badge-chronicle-rose text-[10px]">
              {typeof a === 'string' ? a : a.name}
            </span>
          ))}
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
          {topProblems.map((p, i) => (
            <span key={i} className="text-xs text-foreground/80">
              {typeof p === 'string' ? p : p.name}
              {i < topProblems.length - 1 && ','}
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
  LabResultsSection,
  MiniClinicalSummary
};
