/**
 * TeamRosterPlansTab - Manage team roster plans
 * Chronicle Design System styling
 */
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import { toast } from 'sonner';
import {
  useDepartmentRosterPlans,
  useTeamRosterPlans,
  useCreateTeamRosterPlan,
  useUpdateTeamRosterPlan,
  useDeleteTeamRosterPlan,
} from '@/hooks/useOrganization';
import { toList, toValue, formatRosterName, safeDate } from './utils';
import { DUTY_STATUS_OPTIONS, STATUS_BADGE_CLASSES, SELECT_ALL, SELECT_NONE } from './constants';
import { useUnitOptions } from './useUnitOptions';
import { EmptyState, RosterHeader, InlineField, FieldRow } from './components';

export function TeamRosterPlansTab() {
  const { isLoading: unitsLoading, teams, unitById } = useUnitOptions();
  const [selectedTeam, setSelectedTeam] = useState(SELECT_ALL);
  const [showForm, setShowForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);

  const teamFilter = selectedTeam === SELECT_ALL ? undefined : selectedTeam;

  const { data: teamPlansData, isLoading } = useTeamRosterPlans({
    team: teamFilter,
  });
  const plans = toList(teamPlansData);

  const { data: departmentPlansData } = useDepartmentRosterPlans();
  const departmentPlans = toList(departmentPlansData);

  const createPlan = useCreateTeamRosterPlan();
  const updatePlan = useUpdateTeamRosterPlan();
  const deletePlan = useDeleteTeamRosterPlan();

  const [formState, setFormState] = useState({
    team: '',
    department_plan: '',
    name: '',
    effective_from: '',
    effective_until: '',
    status: 'draft',
    version: 1,
    notes: '',
  });

  useEffect(() => {
    if (!showForm) {
      setEditingPlan(null);
      setFormState({
        team: teamFilter || '',
        department_plan: '',
        name: '',
        effective_from: '',
        effective_until: '',
        status: 'draft',
        version: 1,
        notes: '',
      });
    }
  }, [showForm, selectedTeam]);

  const openForm = (plan) => {
    if (plan) {
      setEditingPlan(plan);
      setFormState({
        team: toValue(plan.team),
        department_plan: toValue(plan.department_plan),
        name: plan.name || '',
        effective_from: safeDate(plan.effective_from),
        effective_until: plan.effective_until ? safeDate(plan.effective_until) : '',
        status: plan.status || 'draft',
        version: plan.version ?? 1,
        notes: plan.notes || '',
      });
    } else {
      setEditingPlan(null);
      setFormState((prev) => ({
        ...prev,
        team: selectedTeam || prev.team,
      }));
    }
    setShowForm(true);
  };

  const handleSubmit = async () => {
    try {
      const payload = {
        team: formState.team,
        department_plan: formState.department_plan === SELECT_NONE ? null : (formState.department_plan || null),
        name: formState.name.trim(),
        effective_from: formState.effective_from,
        effective_until: formState.effective_until || null,
        status: formState.status,
        version: Number(formState.version) || 1,
        notes: formState.notes?.trim() || '',
      };
      if (!payload.team || !payload.name || !payload.effective_from) {
        toast.error('Team, name, and effective start date are required.');
        return;
      }
      if (editingPlan) {
        await updatePlan.mutateAsync({ id: editingPlan.id, data: payload });
        toast.success('Team plan updated.');
      } else {
        await createPlan.mutateAsync(payload);
        toast.success('Team plan created.');
      }
      setShowForm(false);
    } catch (error) {
      toast.error(error.message || 'Failed to save team plan.');
    }
  };

  const handleDelete = async (plan) => {
    if (!confirm('Delete this team roster plan?')) return;
    try {
      await deletePlan.mutateAsync(plan.id);
      toast.success('Team plan deleted.');
    } catch (error) {
      toast.error(error.message || 'Failed to delete team plan.');
    }
  };

  return (
    <div className="space-y-6">
      <RosterHeader
        title="Team Roster Plans"
        subtitle="Optional team-level plans linked to department coverage."
        actions={
          <Button onClick={() => openForm(null)}>
            <Plus className="h-4 w-4 mr-2" />
            <span className="font-mono text-xs uppercase tracking-wide">Add Team Plan</span>
          </Button>
        }
      />

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <InlineField label="Filter by Team">
            <Select value={selectedTeam} onValueChange={setSelectedTeam}>
              <SelectTrigger>
                <SelectValue placeholder="All teams" />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                <SelectItem value={SELECT_ALL}>All teams</SelectItem>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          {unitsLoading || isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : plans.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No team plans yet"
              description="Create team plans to capture more granular scheduling."
            />
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Plan</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Team</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Dept Plan</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Effective</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Status</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.map((plan, index) => (
                    <TableRow key={plan.id} className="animate-chronicle-enter" style={{ animationDelay: `${index * 30}ms` }}>
                      <TableCell>
                        <div className="font-heading font-medium">{plan.name}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">Version {plan.version}</div>
                      </TableCell>
                      <TableCell className="text-sm">{formatRosterName(unitById.get(plan.team)?.name, plan.team_name)}</TableCell>
                      <TableCell className="text-sm">
                        {formatRosterName(departmentPlans.find((dp) => dp.id === plan.department_plan)?.name, plan.department_plan_name)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {safeDate(plan.effective_from)}
                        {plan.effective_until && <span className="text-muted-foreground"> → {safeDate(plan.effective_until)}</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('text-[10px] font-mono capitalize', STATUS_BADGE_CLASSES[plan.status] || '')}>
                          {plan.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openForm(plan)}>Edit</Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(plan)}>Delete</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{editingPlan ? 'Edit Team Plan' : 'Add Team Plan'}</DialogTitle>
            <DialogDescription>Team plans optionally align to a department roster plan.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <InlineField label="Team">
              <Select value={formState.team} onValueChange={(v) => setFormState((p) => ({ ...p, team: v }))}>
                <SelectTrigger><SelectValue placeholder="Select team" /></SelectTrigger>
                <SelectContent className="z-[200]">
                  {teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </InlineField>
            <InlineField label="Department Plan (Optional)">
              <Select value={formState.department_plan} onValueChange={(v) => setFormState((p) => ({ ...p, department_plan: v }))}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent className="z-[200]">
                  <SelectItem value={SELECT_NONE}>None</SelectItem>
                  {departmentPlans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </InlineField>
            <FieldRow>
              <InlineField label="Plan Name">
                <Input value={formState.name} onChange={(e) => setFormState((p) => ({ ...p, name: e.target.value }))} />
              </InlineField>
              <InlineField label="Status">
                <Select value={formState.status} onValueChange={(v) => setFormState((p) => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    {DUTY_STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </InlineField>
            </FieldRow>
            <FieldRow>
              <InlineField label="Effective From">
                <Input type="date" value={formState.effective_from} onChange={(e) => setFormState((p) => ({ ...p, effective_from: e.target.value }))} className="font-mono" />
              </InlineField>
              <InlineField label="Effective Until (Optional)">
                <Input type="date" value={formState.effective_until} onChange={(e) => setFormState((p) => ({ ...p, effective_until: e.target.value }))} className="font-mono" />
              </InlineField>
            </FieldRow>
            <FieldRow>
              <InlineField label="Version">
                <Input type="number" min="1" value={formState.version} onChange={(e) => setFormState((p) => ({ ...p, version: e.target.value }))} className="font-mono" />
              </InlineField>
              <InlineField label="Notes (Optional)">
                <Textarea value={formState.notes} onChange={(e) => setFormState((p) => ({ ...p, notes: e.target.value }))} rows={2} />
              </InlineField>
            </FieldRow>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createPlan.isPending || updatePlan.isPending}>
              {editingPlan ? 'Save Changes' : 'Create Plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
