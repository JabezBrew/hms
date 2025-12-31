/**
 * CareTeamBadge - Badge component for displaying team assignments.
 *
 * Shows primary vs consulting team status with appropriate styling.
 */
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Users, Stethoscope, UserCheck } from 'lucide-react';

const ROLE_CONFIG = {
  primary: {
    label: 'Primary',
    variant: 'default',
    icon: UserCheck,
    className: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-200',
  },
  consulting: {
    label: 'Consulting',
    variant: 'secondary',
    icon: Stethoscope,
    className: 'bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200',
  },
  co_managing: {
    label: 'Co-Managing',
    variant: 'secondary',
    icon: Users,
    className: 'bg-purple-100 text-purple-800 hover:bg-purple-100 border-purple-200',
  },
  procedure: {
    label: 'Procedure',
    variant: 'outline',
    icon: Stethoscope,
    className: 'bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200',
  },
};

export function CareTeamBadge({
  role = 'primary',
  teamName = null,
  showIcon = true,
  size = 'default',
  className,
}) {
  const config = ROLE_CONFIG[role] || ROLE_CONFIG.consulting;
  const Icon = config.icon;

  return (
    <Badge
      variant={config.variant}
      className={cn(
        'border font-normal',
        config.className,
        size === 'sm' && 'text-xs px-1.5 py-0',
        size === 'lg' && 'text-sm px-3 py-1',
        className
      )}
    >
      {showIcon && (
        <Icon
          className={cn(
            'mr-1',
            size === 'sm' ? 'h-3 w-3' : size === 'lg' ? 'h-4 w-4' : 'h-3.5 w-3.5'
          )}
        />
      )}
      <span>{teamName || config.label}</span>
    </Badge>
  );
}

/**
 * CareTeamList - Shows a list of care team assignments for an admission.
 */
export function CareTeamList({
  primaryTeam = null,
  consultingTeams = [],
  showLabels = true,
  className,
}) {
  if (!primaryTeam && consultingTeams.length === 0) {
    return (
      <div className={cn('text-sm text-muted-foreground', className)}>
        No care teams assigned
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {primaryTeam && (
        <CareTeamBadge
          role="primary"
          teamName={showLabels ? `${primaryTeam.name} (Primary)` : primaryTeam.name}
        />
      )}
      {consultingTeams.map((assignment) => (
        <CareTeamBadge
          key={assignment.id}
          role={assignment.role}
          teamName={assignment.team?.name || assignment.team_name}
        />
      ))}
    </div>
  );
}

export default CareTeamBadge;
