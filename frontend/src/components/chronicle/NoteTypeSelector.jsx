import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import LogOut from 'lucide-react/dist/esm/icons/log-out.js';
import Heart from 'lucide-react/dist/esm/icons/heart.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Folder from 'lucide-react/dist/esm/icons/folder.js';
import Lock from 'lucide-react/dist/esm/icons/lock.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Globe from 'lucide-react/dist/esm/icons/globe.js';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useMemo } from "react";
import { cn } from "@/lib/utils";

import { useAvailableNoteTemplates } from "@/features/clinical-notes/hooks";

// Icon mapping for template icons (Lucide icon names to components)
const ICON_MAP = {
  'file-text': FileText,
  'clipboard-list': ClipboardList,
  'activity': Activity,
  'phone': Phone,
  'user-plus': UserPlus,
  'log-out': LogOut,
  'heart-pulse': Heart,
  'heart': Heart,
  'stethoscope': Stethoscope,
  'folder': Folder,
};

// Color mapping for categories
const CATEGORY_COLORS = {
  general: 'amber',
  soap: 'amber',
  progress: 'amber',
  procedure: 'rose',
  admission: 'emerald',
  discharge: 'emerald',
  nursing: 'sky',
  consultation: 'amber',
  custom: 'violet',
};

// Category display names
const CATEGORY_LABELS = {
  general: 'General',
  soap: 'SOAP Notes',
  progress: 'Progress Notes',
  procedure: 'Procedure Notes',
  admission: 'Admission Notes',
  discharge: 'Discharge Notes',
  nursing: 'Nursing Notes',
  consultation: 'Consultation Notes',
  custom: 'Custom',
};

// Visibility icons
const VISIBILITY_ICONS = {
  private: Lock,
  role: Users,
  department: Building2,
  public: Globe,
};

const CATEGORY_ORDER = ['soap', 'progress', 'procedure', 'admission', 'discharge', 'nursing', 'consultation', 'general', 'custom'];

// Derive steps from template structure
const getStepsFromTemplate = (template) => {
  if (!template.structure) return [];

  // Handle both array and object structure formats
  const sections = Array.isArray(template.structure)
    ? template.structure
    : template.structure.sections || [];

  return sections.map((section, index) => ({
    id: section.name?.toLowerCase().replace(/\s+/g, '_') || `step_${index}`,
    title: section.name || section.section || `Step ${index + 1}`,
  }));
};

/**
 * NoteTypeSelector - Grid of note templates for selection
 *
 * Features:
 * - Fetches available templates from API
 * - Groups templates by category
 * - Shows visibility indicators
 * - Chronicle-styled cards with icons
 *
 * @param {function} onSelect - Callback when a template is selected
 * @param {array} templates - Optional pre-loaded templates (overrides API fetch)
 * @param {boolean} isLoading - Optional loading state for pre-loaded templates
 * @param {boolean} enabled - Enable/disable the API fetch (for lazy loading)
 */
const NoteTypeSelector = ({ onSelect, templates: propTemplates, isLoading: propIsLoading, enabled = true }) => {
  // Use provided templates or fetch from API (with lazy loading support)
  const { data: apiTemplates, isLoading: apiIsLoading } = useAvailableNoteTemplates({ enabled: enabled && !propTemplates });

  const templates = useMemo(
    () => (propTemplates || apiTemplates || []),
    [apiTemplates, propTemplates]
  );
  const isLoading = propIsLoading || apiIsLoading;

  // Group templates by category
  const groupedTemplates = useMemo(() => {
    if (!templates?.length) return {};

    return templates.reduce((acc, template) => {
      const category = template.category || 'custom';
      if (!acc[category]) acc[category] = [];
      acc[category].push(template);
      return acc;
    }, {});
  }, [templates]);

  // Get sorted category keys (system categories first, then custom)
  const sortedCategories = useMemo(() => Object.keys(groupedTemplates).sort((a, b) => {
    const indexA = CATEGORY_ORDER.indexOf(a);
    const indexB = CATEGORY_ORDER.indexOf(b);
    if (indexA === -1 && indexB === -1) return 0;
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  }), [groupedTemplates]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner className="size-8 text-muted-foreground" />
        <span className="ml-3 font-mono text-sm text-muted-foreground">Loading templates…</span>
      </div>
    );
  }

  if (!templates?.length) {
    return (
      <div className="text-center py-12">
        <FileText className="size-12 mx-auto text-muted-foreground/50 mb-4" />
        <h3 className="font-display text-lg text-foreground mb-2">No Templates Available</h3>
        <p className="font-mono text-sm text-muted-foreground">
          No note templates are available. Please contact your administrator.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h3 className="font-display text-2xl text-foreground mb-2">
          Select Note Type
        </h3>
        <p className="font-mono text-sm text-muted-foreground">
          Choose the type of clinical note you want to create
        </p>
      </div>

      {/* Render templates grouped by category */}
      {sortedCategories.map((category) => {
        const categoryTemplates = groupedTemplates[category];
        if (!categoryTemplates?.length) return null;

        const color = CATEGORY_COLORS[category] || 'amber';

        return (
          <div key={category} className="space-y-3">
            {/* Category Header */}
            <h4 className="font-mono text-xs uppercase tracking-wider text-muted-foreground border-b border-border pb-2">
              {CATEGORY_LABELS[category] || category}
            </h4>

            {/* Template Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {categoryTemplates.map((template) => {
                const Icon = ICON_MAP[template.icon] || FileText;
                const VisibilityIcon = VISIBILITY_ICONS[template.visibility] || Globe;
                const steps = getStepsFromTemplate(template);
                const isSystemTemplate = !template.created_by;
                const templateMode = template.latest_published_revision_mode || 'structured';
                const templateVersion = template.latest_published_revision_version;
                const modeLabel = templateMode === 'written'
                  ? 'Written'
                  : templateMode === 'hybrid'
                  ? 'Hybrid'
                  : 'Structured';

                return (
                  <button
                    type="button"
                    key={template.id}
                    onClick={() => onSelect(template)}
                    className={cn(
                      "group relative flex flex-col items-start p-5 rounded-xl border-2 text-left",
                      "transition-all duration-200 ease-out",
                      "hover:shadow-lg hover:-translate-y-0.5",
                      "focus:outline-none focus:ring-2 focus:ring-primary/50",
                      "bg-card border-border",
                      // Color-specific hover states
                      color === 'amber' && "hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-900/10",
                      color === 'rose' && "hover:border-rose-400 hover:bg-rose-50/50 dark:hover:bg-rose-900/10",
                      color === 'sky' && "hover:border-sky-400 hover:bg-sky-50/50 dark:hover:bg-sky-900/10",
                      color === 'emerald' && "hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10",
                      color === 'violet' && "hover:border-violet-400 hover:bg-violet-50/50 dark:hover:bg-violet-900/10"
                    )}
                  >
                    {/* Top row: Icon and visibility */}
                    <div className="flex items-start justify-between w-full mb-3">
                      <div className={cn(
                        "size-10 rounded-lg flex items-center justify-center",
                        "transition-colors duration-200",
                        color === 'amber' && "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
                        color === 'rose' && "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400",
                        color === 'sky' && "bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400",
                        color === 'emerald' && "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
                        color === 'violet' && "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"
                      )}>
                        <Icon className="size-5" />
                      </div>

                      {/* Visibility indicator */}
                      <div className="flex items-center gap-1.5">
                        {isSystemTemplate && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-primary/10 text-primary">
                            System
                          </span>
                        )}
                        <VisibilityIcon className="size-3.5 text-muted-foreground" />
                      </div>
                    </div>

                    {/* Title */}
                    <h4 className="font-display text-base text-foreground mb-1">
                      {template.title}
                    </h4>

                    {/* Description */}
                    {template.description && (
                      <p className="font-mono text-[11px] text-muted-foreground mb-3 line-clamp-2">
                        {template.description}
                      </p>
                    )}

                    {/* Steps indicator */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-auto">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-muted text-muted-foreground uppercase">
                        {modeLabel}
                      </span>
                      {templateVersion ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-muted text-muted-foreground">
                          v{templateVersion}
                        </span>
                      ) : null}
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {template.estimated_steps || steps.length} steps
                      </span>
                      {steps.length > 0 && steps.length <= 4 && (
                        <div className="flex items-center gap-1 overflow-hidden">
                          {steps.slice(0, 4).map((step) => (
                            <span
                              key={step.id}
                              className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-muted text-muted-foreground truncate max-w-[60px]"
                            >
                              {step.title}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Arrow indicator on hover */}
                    <div className={cn(
                      "absolute right-3 top-1/2 -translate-y-1/2",
                      "opacity-0 translate-x-2 transition-all duration-200",
                      "group-hover:opacity-100 group-hover:translate-x-0",
                      color === 'amber' && "text-amber-500",
                      color === 'rose' && "text-rose-500",
                      color === 'sky' && "text-sky-500",
                      color === 'emerald' && "text-emerald-500",
                      color === 'violet' && "text-violet-500"
                    )}>
                      <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Helper text */}
      <p className="text-center font-mono text-xs text-muted-foreground pt-4 border-t border-border">
        An encounter will be automatically created when you complete the note
      </p>
    </div>
  );
};

export default NoteTypeSelector;
export { NoteTypeSelector };
