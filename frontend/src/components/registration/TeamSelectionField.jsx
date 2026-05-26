/**
 * TeamSelectionField - Team selection for registration forms.
 *
 * Behavior:
 * - Shows the on-duty team by default (from duty roster)
 * - Allows manual override if user has permission
 * - Displays duty status badge (on-duty, off-duty)
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { rosterEntriesApi, clinicalUnitsApi } from '@/features/admin/api';
import { cn } from '@/lib/utils';
import { keyWith } from '@/shared/lib/queryKeys';

const teamSelectionKeys = {
  onDutyTeam: (departmentId, context) => keyWith('roster', 'on-duty-team', departmentId, context),
  teams: (departmentId) => keyWith('clinical-units', 'teams', departmentId),
};

/**
 * Fetch on-duty team for a department using the new roster system.
 */
function useOnDutyTeam(departmentId, context, options = {}) {
  return useQuery({
    queryKey: teamSelectionKeys.onDutyTeam(departmentId, context),
    queryFn: async () => {
      if (!departmentId) {
        return null;
      }
      // Use the new on-duty endpoint for the department
      const response = await rosterEntriesApi.onDutyDepartment(departmentId);
      // apiClient.get returns results array directly (unwrapped)
      const results = Array.isArray(response) ? response : (response?.results || []);

      if (results.length > 0) {
        // Return the first on-duty entry (usually the primary duty type)
        const entry = results[0];
        return {
          id: entry.team_id,
          name: entry.team_name,
          roster_entry: {
            id: entry.id,
            date: entry.date,
            start_time: entry.start_time,
            end_time: entry.end_time,
          },
        };
      }
      return null;
    },
    enabled: !!departmentId && options.enabled !== false,
    retry: false,
    staleTime: 60 * 1000,
    ...options,
  });
}

/**
 * Fetch teams that can admit patients within a department.
 */
function useTeamsInDepartment(departmentId, options = {}) {
  return useQuery({
    queryKey: teamSelectionKeys.teams(departmentId),
    queryFn: async () => {
      if (!departmentId) {
        return [];
      }
      const response = await clinicalUnitsApi.descendants(departmentId, {
        is_active: true,
        accepts_admissions: true,
      });
      const payload = response?.data?.results || response?.results || response?.data || response;
      const results = Array.isArray(payload) ? payload : [];
      return results.filter((team) => team.is_active !== false);
    },
    enabled: !!departmentId && options.enabled !== false,
    staleTime: 30 * 1000,
    ...options,
  });
}

/**
 * Team selection field for registration forms.
 *
 * @param {Object} props
 * @param {string} props.departmentId - Department UUID
 * @param {string} props.encounterType - 'inpatient' | 'emergency' | 'outpatient'
 * @param {string} props.value - Selected team UUID
 * @param {function} props.onChange - Callback when selection changes
 * @param {boolean} props.disabled - Whether the field is disabled
 */
export function TeamSelectionField({
  departmentId,
  encounterType,
  value,
  onChange,
  disabled = false,
}) {
  // Determine context based on encounter type
  const context = encounterType === 'emergency' ? 'emergency' : 'inpatient';
  const unitId = departmentId || undefined;
  const hasDepartment = !!departmentId;

  // Only show for inpatient/emergency
  const isApplicable = encounterType === 'inpatient' || encounterType === 'emergency';
  const canQuery = isApplicable && hasDepartment;

  // Fetch on-duty team
  const {
    data: onDutyTeam,
    isLoading: loadingDuty,
  } = useOnDutyTeam(unitId, context, {
    enabled: canQuery,
  });

  // Fetch available teams in department
  const {
    data: teams = [],
    isLoading: loadingTeams,
  } = useTeamsInDepartment(unitId, {
    enabled: canQuery,
  });

  // Auto-select on-duty team when available and no value selected
  useEffect(() => {
    if (onDutyTeam && !value && isApplicable) {
      onChange(onDutyTeam.id);
    }
  }, [onDutyTeam, value, onChange, isApplicable]);

  useEffect(() => {
    if (value && !teams.some((team) => team.id === value) && onDutyTeam?.id !== value) {
      onChange('');
    }
  }, [teams, onDutyTeam, value, onChange]);

  useEffect(() => {
    if (!canQuery && value) {
      onChange('');
    }
  }, [canQuery, value, onChange]);

  // Don't render for outpatient
  if (!isApplicable) {
    return null;
  }

  const isLoading = loadingDuty || loadingTeams;

  // If on-duty team exists and is auto-selected, show confirmation
  const isAutoSelected = onDutyTeam && value === onDutyTeam.id;
  const hasTeams = teams.length > 0;

  // No teams available
  if (!isLoading && !hasTeams && !onDutyTeam) {
    return (
      <div className="space-y-2">
        <Label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          <Users className="size-4" />
          Admitting Team
        </Label>
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 text-amber-600 dark:text-amber-400" />
            <p className="text-sm text-amber-700 dark:text-amber-300">
              No teams configured for this department
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <Users className="size-4" />
        Admitting Team
        {onDutyTeam && (
          <Badge
            variant="outline"
            className="ml-2 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800"
          >
            <Clock className="size-3 mr-1" />
            On Duty: {onDutyTeam.name}
          </Badge>
        )}
      </Label>

      {isAutoSelected ? (
        // Show auto-selected confirmation with option to change
        <div className="space-y-2">
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
                <p className="text-sm text-emerald-700 dark:text-emerald-300">
                  Auto-selected: <span className="font-mono font-medium">{onDutyTeam.name}</span>
                </p>
              </div>
              {teams.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange('')}
                  className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
                  disabled={disabled}
                >
                  Change
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        // Show team selector
        <Select
          value={value}
          onValueChange={onChange}
          disabled={disabled || isLoading}
        >
          <SelectTrigger className="font-mono">
            <SelectValue placeholder={isLoading ? 'Loading teams...' : 'Select team'} />
          </SelectTrigger>
          <SelectContent>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id} className="font-mono">
                <div className="flex items-center gap-2">
                  <span>{team.name}</span>
                  {team.id === onDutyTeam?.id && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-xs ml-2',
                        'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      )}
                    >
                      On Duty
                    </Badge>
                  )}
                </div>
              </SelectItem>
            ))}
            {!hasTeams && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No teams available for this department
              </div>
            )}
          </SelectContent>
        </Select>
      )}

      {!onDutyTeam && hasTeams && (
        <p className="text-xs text-muted-foreground">
          No duty roster entry found. Please select a team manually.
        </p>
      )}
    </div>
  );
}

export default TeamSelectionField;
