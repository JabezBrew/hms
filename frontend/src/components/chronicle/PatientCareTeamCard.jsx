/**
 * PatientCareTeamCard - Displays care team information for a patient encounter.
 *
 * Shows:
 * - Current primary team
 * - Original admitting team (if different from primary - indicates transfer)
 * - Active consulting teams
 */
import Users from 'lucide-react/dist/esm/icons/users.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import UserCheck from 'lucide-react/dist/esm/icons/user-check.js';
import History from 'lucide-react/dist/esm/icons/history.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CareTeamBadge } from '@/components/organization/CareTeamBadge';
import { cn } from '@/lib/utils';

/**
 * PatientCareTeamCard component.
 *
 * @param {Object} props
 * @param {Object} props.encounter - The encounter object with care team data
 * @param {Object} props.encounter.primary_team - Current primary team { id, name, code }
 * @param {Object} props.encounter.admitted_by_team - Original admitting team { id, name, code }
 * @param {Array} props.encounter.care_team_assignments - Consulting/co-managing teams
 * @param {string} props.className - Additional CSS classes
 */
export function PatientCareTeamCard({ encounter, className }) {
  if (!encounter) {
    return null;
  }

  const { primary_team, admitted_by_team, care_team_assignments = [] } = encounter;

  // Check if patient was transferred (admitted_by_team differs from primary_team)
  const wasTransferred =
    admitted_by_team &&
    primary_team &&
    admitted_by_team.id !== primary_team.id;

  // Filter active consulting teams
  const activeConsults = care_team_assignments.filter(
    (a) => a.is_active && (a.status === 'active' || a.status === 'accepted')
  );

  // No teams assigned
  if (!primary_team && activeConsults.length === 0) {
    return (
      <Card className={cn('border-border', className)}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-heading">
            <Users className="h-4 w-4" />
            Care Team
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No care team assigned</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('border-border', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-heading">
          <Users className="h-4 w-4" />
          Care Team
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Primary Team */}
        {primary_team && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Primary Team
              </span>
            </div>
            <p className="font-medium text-foreground pl-6">{primary_team.name}</p>
            {primary_team.code && (
              <p className="font-mono text-xs text-muted-foreground pl-6">
                {primary_team.code}
              </p>
            )}
          </div>
        )}

        {/* Transfer History */}
        {wasTransferred && (
          <div className="flex items-center gap-2 text-sm pl-6 py-2 bg-muted/30 rounded-lg">
            <History className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Originally admitted by:</span>
            <span className="font-medium">{admitted_by_team.name}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground mx-1" />
            <span className="text-xs text-muted-foreground">Transferred</span>
          </div>
        )}

        {/* Consulting Teams */}
        {activeConsults.length > 0 && (
          <div className="space-y-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Consulting Teams
            </span>
            <div className="flex flex-wrap gap-2 pl-0">
              {activeConsults.map((consult) => (
                <CareTeamBadge
                  key={consult.id}
                  role={consult.role || 'consulting'}
                  teamName={consult.team?.name || consult.team_name}
                  size="sm"
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Compact version for sidebar use.
 */
export function PatientCareTeamCompact({ encounter, className }) {
  if (!encounter) {
    return null;
  }

  const { primary_team, admitted_by_team, care_team_assignments = [] } = encounter;

  const wasTransferred =
    admitted_by_team &&
    primary_team &&
    admitted_by_team.id !== primary_team.id;

  const activeConsults = care_team_assignments.filter(
    (a) => a.is_active && (a.status === 'active' || a.status === 'accepted')
  );

  if (!primary_team && activeConsults.length === 0) {
    return (
      <div className={cn('text-sm text-muted-foreground', className)}>
        No care team assigned
      </div>
    );
  }

  return (
    <section className={className}>
      <header className="flex items-center justify-between mb-3">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Care Team
        </h3>
        {activeConsults.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            +{activeConsults.length} consulting
          </Badge>
        )}
      </header>

      <div className="space-y-2">
        {/* Primary Team */}
        {primary_team && (
          <div
            className={cn(
              'flex items-center gap-3 p-3 rounded-lg',
              'bg-emerald-50/50 dark:bg-emerald-900/20',
              'border border-emerald-200 dark:border-emerald-800'
            )}
          >
            <UserCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100 truncate">
                {primary_team.name}
              </p>
              {wasTransferred && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                  <span className="opacity-70">from</span> {admitted_by_team.name}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Consulting Teams */}
        {activeConsults.length > 0 && (
          <ul className="space-y-1.5">
            {activeConsults.slice(0, 3).map((consult) => (
              <li
                key={consult.id}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg',
                  'bg-card/50 border border-border'
                )}
              >
                <CareTeamBadge
                  role={consult.role || 'consulting'}
                  teamName={consult.team?.name || consult.team_name}
                  size="sm"
                  showIcon={false}
                />
              </li>
            ))}
            {activeConsults.length > 3 && (
              <li className="text-xs text-muted-foreground text-center py-1">
                +{activeConsults.length - 3} more
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

export default PatientCareTeamCard;
