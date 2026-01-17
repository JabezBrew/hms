import LogIn from 'lucide-react/dist/esm/icons/log-in.js';
import LogOut from 'lucide-react/dist/esm/icons/log-out.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import UserCog from 'lucide-react/dist/esm/icons/user-cog.js';
import FileEdit from 'lucide-react/dist/esm/icons/file-pen.js';
import FilePlus from 'lucide-react/dist/esm/icons/file-plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

/**
 * AuditLogCard - Chronicle-style audit log entry card
 */
const AuditLogCard = ({ log, index = 0, className }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // ============================================
  // Styling helpers
  // ============================================

  const getCategoryConfig = (category) => {
    const configs = {
      AUTHENTICATION: {
        label: 'Auth',
        icon: Shield,
        badgeClass: 'bg-violet-500/10 text-violet-600 border-violet-500/30',
        accentClass: 'from-violet-500/20',
      },
      PATIENT: {
        label: 'Patient',
        icon: User,
        badgeClass: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
        accentClass: 'from-sky-500/20',
      },
      CLINICAL: {
        label: 'Clinical',
        icon: Stethoscope,
        badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
        accentClass: 'from-emerald-500/20',
      },
      ENCOUNTER: {
        label: 'Encounter',
        icon: Activity,
        badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
        accentClass: 'from-amber-500/20',
      },
      ADMIN: {
        label: 'Admin',
        icon: Shield,
        badgeClass: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
        accentClass: 'from-rose-500/20',
      },
      WARD: {
        label: 'Ward',
        icon: Bed,
        badgeClass: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/30',
        accentClass: 'from-indigo-500/20',
      },
      APPOINTMENT: {
        label: 'Appointment',
        icon: Calendar,
        badgeClass: 'bg-pink-500/10 text-pink-600 border-pink-500/30',
        accentClass: 'from-pink-500/20',
      },
    };
    return configs[category] || {
      label: category,
      icon: Activity,
      badgeClass: 'bg-muted text-muted-foreground border-border',
      accentClass: 'from-muted/50',
    };
  };

  const getActionIcon = (action) => {
    const icons = {
      LOGIN: LogIn,
      LOGOUT: LogOut,
      LOGIN_FAILED: AlertTriangle,
      PASSWORD_CHANGE: Shield,
      CREATE: FilePlus,
      READ: Eye,
      UPDATE: FileEdit,
      DELETE: Trash2,
      NOTE_CREATE: FilePlus,
      NOTE_UPDATE: FileEdit,
      NOTE_DELETE: Trash2,
      ORDER_CREATE: FilePlus,
      USER_CREATE: UserPlus,
      USER_UPDATE: UserCog,
      ROLE_CHANGE: Shield,
      ADMISSION: Bed,
      DISCHARGE: LogOut,
      TRANSFER: Activity,
      CHECK_IN: LogIn,
      CANCEL: Trash2,
    };
    return icons[action] || Activity;
  };

  const getActionColor = (action) => {
    if (action.includes('DELETE') || action === 'LOGIN_FAILED' || action === 'CANCEL') {
      return 'text-destructive';
    }
    if (action.includes('CREATE') || action === 'LOGIN' || action === 'ADMISSION') {
      return 'text-emerald-600';
    }
    if (action.includes('UPDATE') || action === 'TRANSFER') {
      return 'text-amber-600';
    }
    return 'text-muted-foreground';
  };

  // ============================================
  // Extracted data
  // ============================================

  const categoryConfig = getCategoryConfig(log.category);
  const CategoryIcon = categoryConfig.icon;
  const ActionIcon = getActionIcon(log.action);
  const actionColor = getActionColor(log.action);

  const hasChanges = log.changes && Object.keys(log.changes).length > 0;

  // ============================================
  // Render
  // ============================================

  return (
    <article
      className={cn(
        "group relative bg-card/50 backdrop-blur border border-border",
        "rounded-xl sm:rounded-2xl p-4 sm:p-5 transition-all duration-300",
        "hover:border-primary/30 hover:shadow-md",
        "animate-chronicle-enter",
        className
      )}
      style={{ animationDelay: `${index * 30}ms` }}
    >
      {/* Category Accent Bar */}
      <div className={cn(
        "absolute top-0 left-0 right-0 h-1 rounded-t-xl sm:rounded-t-2xl",
        `bg-gradient-to-r ${categoryConfig.accentClass} to-transparent`
      )} />

      {/* Header */}
      <header className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Action Icon */}
          <div className={cn(
            "shrink-0 w-9 h-9 rounded-lg flex items-center justify-center",
            "bg-background border border-border"
          )}>
            <ActionIcon className={cn("h-4 w-4", actionColor)} />
          </div>

          {/* Description */}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">
              {log.description}
            </p>
            <p className="font-mono text-[10px] sm:text-xs text-muted-foreground">
              {log.user_display || log.user_email}
              <span className="mx-1.5">·</span>
              {log.time_ago}
            </p>
          </div>
        </div>

        {/* Category Badge */}
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 text-[10px] sm:text-xs font-medium",
            categoryConfig.badgeClass
          )}
        >
          {categoryConfig.label}
        </Badge>
      </header>

      {/* Details Row */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-3">
        {log.resource_type && (
          <span className="font-mono bg-muted/50 px-2 py-0.5 rounded">
            {log.resource_type}
          </span>
        )}
        {log.resource_name && (
          <span className="truncate max-w-[150px] sm:max-w-[200px]">
            {log.resource_name}
          </span>
        )}
        {log.ip_address && (
          <span className="font-mono hidden sm:inline">
            IP: {log.ip_address}
          </span>
        )}
      </div>

      {/* Action Badge */}
      <div className="flex items-center justify-between">
        <Badge variant="secondary" className="font-mono text-[10px]">
          {log.action_display || log.action}
        </Badge>

        {/* Expandable Changes */}
        {hasChanges && (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs font-mono"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="h-3 w-3 mr-1" />
                    Hide Changes
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" />
                    View Changes
                  </>
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                {Object.entries(log.changes).map(([field, change]) => (
                  <div key={field} className="text-xs">
                    <span className="font-mono font-medium text-foreground">
                      {field}:
                    </span>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mt-1 ml-2">
                      <span className="text-destructive/80 line-through">
                        {JSON.stringify(change.old) || 'null'}
                      </span>
                      <span className="hidden sm:inline text-muted-foreground">→</span>
                      <span className="text-emerald-600">
                        {JSON.stringify(change.new) || 'null'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Timestamp tooltip */}
      <div className="absolute bottom-2 right-3 hidden group-hover:block">
        <span className="text-[10px] text-muted-foreground font-mono">
          {new Date(log.timestamp).toLocaleString()}
        </span>
      </div>
    </article>
  );
};

export default AuditLogCard;
export { AuditLogCard };
