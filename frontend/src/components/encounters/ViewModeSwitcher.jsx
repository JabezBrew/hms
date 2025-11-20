import { useViewMode, VIEW_MODES } from '@/contexts/ViewModeContext';
import { Button } from '@/components/ui/button';
import {
  FileText,
  LayoutGrid,
  Activity,
  ToggleLeft
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ViewModeSwitcher() {
  const { viewMode, setViewMode } = useViewMode();

  const modes = [
    {
      value: VIEW_MODES.DOCUMENTATION,
      label: 'Documentation',
      description: 'Full-screen for clinical documentation',
      icon: FileText,
    },
    {
      value: VIEW_MODES.REVIEW,
      label: 'Review',
      description: 'Quick overview with patient context',
      icon: LayoutGrid,
    },
    {
      value: VIEW_MODES.MONITORING,
      label: 'Monitoring',
      description: 'Vitals and alerts prominent',
      icon: Activity,
    },
  ];

  const currentMode = modes.find((m) => m.value === viewMode);
  const CurrentIcon = currentMode?.icon || LayoutGrid;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <CurrentIcon className="h-4 w-4" />
          <span className="hidden md:inline">{currentMode?.label}</span>
          <span className="md:hidden">View</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>View Mode</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {modes.map((mode) => {
          const Icon = mode.icon;
          const isActive = viewMode === mode.value;

          return (
            <DropdownMenuItem
              key={mode.value}
              onClick={() => setViewMode(mode.value)}
              className={isActive ? 'bg-accent' : ''}
            >
              <div className="flex items-start gap-3 w-full">
                <Icon className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium flex items-center gap-2">
                    {mode.label}
                    {isActive && (
                      <span className="text-xs text-primary">✓</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {mode.description}
                  </div>
                </div>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
