/**
 * TemplatesTab - Manage duty roster templates
 * Chronicle Design System styling
 */
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import { useDutyRosterTemplates } from '@/hooks/useOrganization';
import { toList } from './utils';
import { DAYS_OF_WEEK } from './constants';
import { EmptyState, RosterHeader } from './components';

export function TemplatesTab() {
  const { data, isLoading } = useDutyRosterTemplates();
  const templates = toList(data);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <RosterHeader
        title="Duty Templates"
        subtitle="Recurring patterns for automatic roster generation."
        actions={
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            <span className="font-mono text-xs uppercase tracking-wide">Add Template</span>
          </Button>
        }
      />

      {templates.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title="No templates yet"
          description="Create templates to auto-generate rosters based on recurring patterns."
          action={
            <Button variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Create First Template
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">Unit</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">Practitioner</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">Day</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">Time</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">Role</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">Seniority</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">Primary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template, index) => (
                <TableRow
                  key={template.id}
                  className="animate-chronicle-enter"
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <TableCell className="font-heading font-medium">{template.unit_name}</TableCell>
                  <TableCell className="text-sm">{template.practitioner_name}</TableCell>
                  <TableCell className="text-sm">{DAYS_OF_WEEK[template.day_of_week]}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {template.effective_start_time} - {template.effective_end_time}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {template.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px] font-mono',
                        template.seniority_level === 'attending' &&
                          'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
                        template.seniority_level === 'resident' &&
                          'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20'
                      )}
                    >
                      {template.seniority_level}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {template.is_primary && (
                      <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] font-mono uppercase">
                        Primary
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
