import { cn } from "@/lib/utils";
import { FileText, ClipboardList, Activity, Phone } from "lucide-react";

/**
 * NoteTypeSelector - Grid of note type cards for selection
 *
 * Features:
 * - Chronicle-styled cards with icons
 * - Color-coded by note category
 * - Hover states and animations
 */
const NoteTypeSelector = ({ noteTypes, onSelect }) => {
  // Icon mapping
  const icons = {
    progress: FileText,
    soap: ClipboardList,
    procedure: Activity,
    phone: Phone
  };

  // Descriptions for each note type
  const descriptions = {
    progress: 'Quick clinical update with assessment and plan',
    soap: 'Structured note with Subjective, Objective, Assessment, Plan',
    procedure: 'Document a clinical procedure with pre/post details',
    phone: 'Record phone conversation with patient or family'
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-2xl text-foreground mb-2">
          Select Note Type
        </h3>
        <p className="font-mono text-sm text-muted-foreground">
          Choose the type of clinical note you want to create
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Object.entries(noteTypes).map(([typeId, config]) => {
          const Icon = icons[typeId] || FileText;

          return (
            <button
              key={typeId}
              onClick={() => onSelect(typeId)}
              className={cn(
                "group relative flex flex-col items-start p-6 rounded-xl border-2 text-left",
                "transition-all duration-200 ease-out",
                "hover:shadow-lg hover:-translate-y-0.5",
                "focus:outline-none focus:ring-2 focus:ring-primary/50",
                // Base styles
                "bg-card border-border",
                // Color-specific hover states
                config.color === 'amber' && "hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-900/10",
                config.color === 'rose' && "hover:border-rose-400 hover:bg-rose-50/50 dark:hover:bg-rose-900/10",
                config.color === 'sky' && "hover:border-sky-400 hover:bg-sky-50/50 dark:hover:bg-sky-900/10"
              )}
            >
              {/* Icon */}
              <div className={cn(
                "w-12 h-12 rounded-lg flex items-center justify-center mb-4",
                "transition-colors duration-200",
                config.color === 'amber' && "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 group-hover:bg-amber-200 dark:group-hover:bg-amber-900/50",
                config.color === 'rose' && "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400 group-hover:bg-rose-200 dark:group-hover:bg-rose-900/50",
                config.color === 'sky' && "bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400 group-hover:bg-sky-200 dark:group-hover:bg-sky-900/50"
              )}>
                <Icon className="h-6 w-6" />
              </div>

              {/* Title */}
              <h4 className="font-display text-lg text-foreground mb-1">
                {config.name}
              </h4>

              {/* Description */}
              <p className="font-mono text-xs text-muted-foreground mb-4">
                {descriptions[typeId]}
              </p>

              {/* Steps indicator */}
              <div className="flex items-center gap-1.5 mt-auto">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {config.steps.length} steps:
                </span>
                <div className="flex items-center gap-1">
                  {config.steps.map((step, i) => (
                    <span
                      key={step.id}
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-mono",
                        "bg-muted text-muted-foreground"
                      )}
                    >
                      {step.title}
                    </span>
                  ))}
                </div>
              </div>

              {/* Arrow indicator on hover */}
              <div className={cn(
                "absolute right-4 top-1/2 -translate-y-1/2",
                "opacity-0 translate-x-2 transition-all duration-200",
                "group-hover:opacity-100 group-hover:translate-x-0",
                config.color === 'amber' && "text-amber-500",
                config.color === 'rose' && "text-rose-500",
                config.color === 'sky' && "text-sky-500"
              )}>
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          );
        })}
      </div>

      {/* Helper text */}
      <p className="text-center font-mono text-xs text-muted-foreground pt-4 border-t border-border">
        An encounter will be automatically created when you complete the note
      </p>
    </div>
  );
};

export default NoteTypeSelector;
export { NoteTypeSelector };
