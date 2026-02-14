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
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up.js';
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down.js';
import ArrowUpDown from 'lucide-react/dist/esm/icons/arrow-up-down.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import Receipt from 'lucide-react/dist/esm/icons/receipt.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import HeartPulse from 'lucide-react/dist/esm/icons/heart-pulse.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import VirtualizedList from '@/components/ui/VirtualizedList';
import format from 'date-fns/format';

/**
 * SortableHeader - Clickable column header with sort indicator
 */
const SortableHeader = ({ field, label, currentSort, onSort, className }) => {
  const isActive = currentSort === field || currentSort === `-${field}`;
  const isDesc = currentSort === `-${field}`;

  const handleClick = () => {
    if (currentSort === `-${field}`) {
      onSort(field); // Switch to ascending
    } else {
      onSort(`-${field}`); // Switch to descending (or set descending as default)
    }
  };

  return (
    <div
      role="columnheader"
      className={cn(
        "px-3 py-2 text-xs font-mono text-muted-foreground",
        className
      )}
      aria-sort={isActive ? (isDesc ? 'descending' : 'ascending') : 'none'}
      aria-label={`Sort by ${label}`}
    >
      <button
        type="button"
        onClick={handleClick}
        className="flex items-center gap-1 w-full text-left hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {label}
        {isActive ? (
          isDesc ? (
            <ArrowDown className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ArrowUp className="h-3 w-3" aria-hidden="true" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" aria-hidden="true" />
        )}
      </button>
    </div>
  );
};

/**
 * AuditLogTable - Table view for audit logs
 */
const AuditLogTable = ({ logs, className, sortBy, onSortChange }) => {
  const [expandedRows, setExpandedRows] = useState(new Set());
  const gridClassName = "grid grid-cols-[40px_160px_200px_130px_110px_1fr_120px]";

  const toggleRow = (id) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className={cn("rounded-lg overflow-hidden border border-border/60", className)} role="table">
      <div
        role="row"
        className={cn(gridClassName, "bg-muted/50 text-xs font-mono sticky top-0 z-10")}
      >
        <div role="columnheader" className="px-2 py-2 text-muted-foreground" />
        <SortableHeader
          field="timestamp"
          label="Timestamp"
          currentSort={sortBy}
          onSort={onSortChange}
        />
        <SortableHeader
          field="user_email"
          label="User"
          currentSort={sortBy}
          onSort={onSortChange}
        />
        <SortableHeader
          field="action"
          label="Action"
          currentSort={sortBy}
          onSort={onSortChange}
        />
        <SortableHeader
          field="category"
          label="Category"
          currentSort={sortBy}
          onSort={onSortChange}
        />
        <div role="columnheader" className="px-3 py-2 text-muted-foreground">Resource</div>
        <SortableHeader
          field="ip_address"
          label="IP Address"
          currentSort={sortBy}
          onSort={onSortChange}
        />
      </div>
      <div role="rowgroup">
        <VirtualizedList
          items={logs}
          estimateSize={84}
          gap={0}
          getItemKey={(log) => log.id}
          renderItem={(log) => (
            <AuditLogRow
              log={log}
              isExpanded={expandedRows.has(log.id)}
              onToggle={() => toggleRow(log.id)}
              gridClassName={gridClassName}
            />
          )}
        />
      </div>
    </div>
  );
};

/**
 * AuditLogRow - Individual table row with expansion
 */
const AuditLogRow = ({ log, isExpanded, onToggle, gridClassName }) => {
  const categoryConfig = getCategoryConfig(log.category);
  const ActionIcon = getActionIcon(log.action);
  const actionColorClass = getActionColorClass(log.action);
  const hasChanges = log.changes && Object.keys(log.changes).length > 0;

  const rowHighlight = getRowHighlight(log.action);

  return (
    <div className="border-b border-border/50">
      <div
        className={cn(
          gridClassName,
          "items-start",
          "group cursor-pointer transition-colors",
          rowHighlight,
          isExpanded && "border-b-0"
        )}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        tabIndex={0}
        role="row"
        aria-expanded={isExpanded}
        aria-label={`${log.description}, click to ${isExpanded ? 'collapse' : 'expand'} details`}
      >
        <div role="cell" className="px-2 py-3">
          <ChevronRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              isExpanded && "rotate-90"
            )}
            aria-hidden="true"
          />
        </div>

        <div role="cell" className="px-3 py-3 font-mono text-xs text-muted-foreground">
          {format(new Date(log.timestamp), 'MMM d, yyyy')}
          <br />
          <span className="text-[10px]">{format(new Date(log.timestamp), 'h:mm:ss a')}</span>
        </div>

        <div role="cell" className="px-3 py-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground truncate max-w-[180px]">
              {log.user_display || log.user_email || '—'}
            </span>
            {log.user_display && log.user_email && (
              <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[180px]">
                {log.user_email}
              </span>
            )}
          </div>
        </div>

        <div role="cell" className="px-3 py-3">
          <div className="flex items-center gap-1.5">
            <ActionIcon className={cn("h-3.5 w-3.5", actionColorClass)} aria-hidden="true" />
            <span className={cn("text-xs font-medium", actionColorClass)}>
              {log.action_display || formatAction(log.action)}
            </span>
          </div>
        </div>

        <div role="cell" className="px-3 py-3">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-medium",
              categoryConfig.badgeClass
            )}
          >
            {categoryConfig.label}
          </Badge>
        </div>

        <div role="cell" className="px-3 py-3">
          <div className="flex items-center gap-2">
            {log.resource_type && (
              <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                {log.resource_type}
              </span>
            )}
            {log.resource_name && (
              <span className="text-xs text-foreground truncate max-w-[200px]">
                {log.resource_name}
              </span>
            )}
          </div>
        </div>

        <div role="cell" className="px-3 py-3 font-mono text-xs text-muted-foreground">
          {log.ip_address || '—'}
        </div>
      </div>

      {isExpanded && (
        <div className="pl-10 pr-4 pb-4 pt-2 bg-muted/10">
          <div className="space-y-3">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Description
              </span>
              <p className="text-sm text-foreground mt-1">{log.description}</p>
            </div>

            {(log.user_agent_summary || log.user_agent) && (
              <div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Client
                </span>
                {log.user_agent_summary && (
                  <p className="font-mono text-xs text-foreground mt-1">
                    {log.user_agent_summary}
                  </p>
                )}
                {log.user_agent && (
                  <p className="font-mono text-xs text-muted-foreground mt-1 truncate">
                    {log.user_agent}
                  </p>
                )}
              </div>
            )}

            {hasChanges && (
              <div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Changes
                </span>
                <div className="mt-2 bg-background rounded-lg border border-border p-3 space-y-2">
                  {Object.entries(log.changes).map(([field, change]) => (
                    <div key={field} className="flex items-start gap-3 text-xs">
                      <span className="font-mono font-medium text-foreground min-w-[100px]">
                        {field}
                      </span>
                      <span className="text-destructive/80 line-through">
                        {formatChangeValue(change.old)}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-emerald-600">
                        {formatChangeValue(change.new)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Helper functions

const getCategoryConfig = (category) => {
  const configs = {
    AUTHENTICATION: {
      label: 'Auth',
      icon: Shield,
      badgeClass: 'bg-violet-500/10 text-violet-600 border-violet-500/30',
    },
    PATIENT: {
      label: 'Patient',
      icon: User,
      badgeClass: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
    },
    CLINICAL: {
      label: 'Clinical',
      icon: Stethoscope,
      badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    },
    ENCOUNTER: {
      label: 'Encounter',
      icon: Activity,
      badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    },
    ADMIN: {
      label: 'Admin',
      icon: Shield,
      badgeClass: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
    },
    WARD: {
      label: 'Ward',
      icon: Bed,
      badgeClass: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/30',
    },
    APPOINTMENT: {
      label: 'Appointment',
      icon: Calendar,
      badgeClass: 'bg-pink-500/10 text-pink-600 border-pink-500/30',
    },
    LABORATORY: {
      label: 'Lab',
      icon: FlaskConical,
      badgeClass: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/30',
    },
    BILLING: {
      label: 'Billing',
      icon: Receipt,
      badgeClass: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
    },
    PHARMACY: {
      label: 'Pharmacy',
      icon: Pill,
      badgeClass: 'bg-teal-500/10 text-teal-600 border-teal-500/30',
    },
    VITALS: {
      label: 'Vitals',
      icon: HeartPulse,
      badgeClass: 'bg-red-500/10 text-red-600 border-red-500/30',
    },
    NURSING: {
      label: 'Nursing',
      icon: HeartPulse,
      badgeClass: 'bg-fuchsia-500/10 text-fuchsia-600 border-fuchsia-500/30',
    },
    REFERRAL: {
      label: 'Referral',
      icon: Send,
      badgeClass: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
    },
  };
  return configs[category] || {
    label: category,
    icon: Activity,
    badgeClass: 'bg-muted text-muted-foreground border-border',
  };
};

const getActionIcon = (action) => {
  const icons = {
    LOGIN: LogIn,
    LOGOUT: LogOut,
    LOGIN_FAILED: AlertTriangle,
    PASSWORD_CHANGE: Shield,
    OFFSITE_ACCESS: AlertTriangle,
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

const getActionColorClass = (action) => {
  if (action.includes('DELETE') || action === 'LOGIN_FAILED' || action === 'CANCEL') {
    return 'text-destructive';
  }
  if (action.includes('CREATE') || action === 'LOGIN' || action === 'ADMISSION') {
    return 'text-emerald-600';
  }
  if (action.includes('UPDATE') || action === 'TRANSFER') {
    return 'text-amber-600';
  }
  if (action === 'LOGOUT') {
    return 'text-muted-foreground';
  }
  return 'text-foreground';
};

const getRowHighlight = (action) => {
  if (action === 'LOGIN_FAILED') {
    return 'bg-destructive/5 hover:bg-destructive/10';
  }
  if (action.includes('DELETE')) {
    return 'hover:bg-amber-500/5';
  }
  return 'hover:bg-muted/50';
};

const formatAction = (action) => {
  return action
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
};

const formatChangeValue = (value) => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

export default AuditLogTable;
export { AuditLogTable };
