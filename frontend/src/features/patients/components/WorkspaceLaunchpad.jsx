import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import TestTube from 'lucide-react/dist/esm/icons/test-tube.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Droplets from 'lucide-react/dist/esm/icons/droplets.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import History from 'lucide-react/dist/esm/icons/history.js';

import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

const QUICK_ACTIONS = [
  { id: 'note', label: 'Add Note', icon: FileText, always: true },
  { id: 'vitals', label: 'Record Vitals', icon: Activity, always: true },
  { id: 'prescription', label: 'Prescribe', icon: Pill, always: true },
  { id: 'labs', label: 'Order Labs', icon: TestTube, always: true },
  { id: 'referral', label: 'Request Consult', icon: Stethoscope, always: true },
  { id: 'medicationHistory', label: 'Med History', icon: History, always: true },
  { id: 'fluids', label: 'Record Fluids', icon: Droplets, admitted: true },
  { id: 'wardRound', label: 'Ward Round', icon: ClipboardList, admitted: true },
];

const COPILOT_PROMPTS = [
  'Summarize last 24h',
  'What changed since last encounter?',
  'Risks to monitor today',
];

export default function WorkspaceLaunchpad({ workspaceContext }) {
  const { patient, openWorkspace } = workspaceContext;
  const isAdmitted = !!(
    patient?.local_data?.current_admission_id ||
    patient?.current_admission_id
  );

  const visibleActions = QUICK_ACTIONS.filter(
    (a) => a.always || (a.admitted && isAdmitted)
  );

  return (
    <ScrollArea className="h-full">
      <div className="space-y-8 p-6">
        {/* Quick Actions */}
        <section>
          <h3 className="mb-3 font-heading text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Quick Actions
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {visibleActions.map((action) => (
              <button
                key={action.id}
                onClick={() => openWorkspace(action.id)}
                className={cn(
                  'flex items-center gap-3 rounded-lg border border-border p-3',
                  'text-left transition-colors hover:bg-accent',
                )}
              >
                <action.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-heading text-sm">{action.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* AI Copilot */}
        <section>
          <h3 className="mb-3 font-heading text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Ask Chronicle AI
          </h3>
          <div className="rounded-lg border border-amber-200/50 bg-amber-50/30 p-4 dark:border-amber-900/30 dark:bg-amber-950/20">
            <button
              onClick={() => openWorkspace('copilot')}
              className={cn(
                'flex w-full items-center gap-3 rounded-md p-2',
                'text-left transition-colors hover:bg-amber-100/50 dark:hover:bg-amber-900/20',
              )}
            >
              <div className="rounded-lg bg-amber-500/10 p-2">
                <Sparkles className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <p className="font-heading text-sm font-medium text-foreground">
                  Open AI Copilot
                </p>
                <p className="text-xs text-muted-foreground">
                  Clinical insights for this patient
                </p>
              </div>
            </button>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {COPILOT_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => openWorkspace('copilot')}
                  className={cn(
                    'rounded-full border border-amber-200/60 bg-background px-2.5 py-1',
                    'font-mono text-[10px] text-muted-foreground',
                    'transition-colors hover:border-amber-300 hover:text-foreground',
                    'dark:border-amber-900/40',
                  )}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}
