/**
 * CareTeamBadge - Badge component for displaying team assignments.
 *
 * Shows primary vs consulting team status with appropriate styling.
 */
import Users from 'lucide-react/dist/esm/icons/users.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import UserCheck from 'lucide-react/dist/esm/icons/user-check.js';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

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
  teamRole,
  role: legacyRole,
  teamName = null,
  showIcon = true,
  size = 'default',
  className,
}) {
  const careTeamRole = teamRole || legacyRole || 'primary';
  const config = ROLE_CONFIG[careTeamRole] || ROLE_CONFIG.consulting;
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
            size === 'sm' ? 'size-3' : size === 'lg' ? 'size-4' : 'size-3.5'
          )}
        />
      )}
      <span>{teamName || config.label}</span>
    </Badge>
  );
}
