/**
 * DepartmentRosterPlansTab - Manage department roster plans
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
import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import { toast } from 'sonner';
import {
  useDepartmentRosterPlans,
  useCreateDepartmentRosterPlan,
  useUpdateDepartmentRosterPlan,
  useDeleteDepartmentRosterPlan,
} from '@/features/admin/hooks';
import { toList, toValue, formatRosterName, safeDate } from './utils';
import { DUTY_STATUS_OPTIONS, STATUS_BADGE_CLASSES, DEFAULT_CYCLE_LENGTH, SELECT_ALL } from './constants';
import { useUnitOptions } from './useUnitOptions';
import { EmptyState, RosterHeader, InlineField, FieldRow } from './components';

export function DepartmentRosterPlansTab() {
  const { isLoading: unitsLoading, departments, unitById } = useUnitOptions();
  const [selectedDepartment, setSelectedDepartment] = useState(SELECT_ALL);
  const [showForm, setShowForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);

  const departmentFilter = selectedDepartment === SELECT_ALL ? undefined : selectedDepartment;

  const { data: plansData, isLoading } = useDepartmentRosterPlans({
    department: departmentFilter,
  });
  const plans = toList(plansData);

  const createPlan = useCreateDepartmentRosterPlan();
  const updatePlan = useUpdateDepartmentRosterPlan();
  const deletePlan = useDeleteDepartmentRosterPlan();

  const [formState, setFormState] = useState({
    department: '',
    name: '',
    cycle_length_days: DEFAULT_CYCLE_LENGTH,
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
        department: departmentFilter || '',
        name: '',
        cycle_length_days: DEFAULT_CYCLE_LENGTH,
        effective_from: '',
        effective_until: '',
        status: 'draft',
        version: 1,
        notes: '',
      });
    }
  }, [showForm, selectedDepartment]);

  const openForm = (plan) => {
    if (plan) {
      setEditingPlan(plan);
      setFormState({
        department: toValue(plan.department),
        name: plan.name || '',
        cycle_length_days: plan.cycle_length_days ?? DEFAULT_CYCLE_LENGTH,
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
        department: selectedDepartment || prev.department,
      }));
    }
    setShowForm(true);
  };

  const handleSubmit = async () => {
    try {
      const payload = {
        department: formState.department,
        name: formState.name.trim(),
        cycle_length_days: Number(formState.cycle_length_days) || DEFAULT_CYCLE_LENGTH,
        effective_from: formState.effective_from,
        effective_until: formState.effective_until || null,
        status: formState.status,
        version: Number(formState.version) || 1,
        notes: formState.notes?.trim() || '',
      };
      if (!payload.department || !payload.name || !payload.effective_from) {
        toast.error('Department, name, and effective start date are required.');
        return;
      }
      if (editingPlan) {
        await updatePlan.mutateAsync({ id: editingPlan.id, data: payload });
        toast.success('Roster plan updated.');
      } else {
        await createPlan.mutateAsync(payload);
        toast.success('Roster plan created.');
      }
      setShowForm(false);
    } catch (error) {
      toast.error(error.message || 'Failed to save roster plan.');
    }
  };

  const handleDelete = async (plan) => {
    if (!confirm('Delete this roster plan?')) return;
    try {
      await deletePlan.mutateAsync(plan.id);
      toast.success('Roster plan deleted.');
    } catch (error) {
      toast.error(error.message || 'Failed to delete roster plan.');
    }
  };

  return (
    <div className="space-y-6">
      <RosterHeader
        title="Department Roster Plans"
        subtitle="Define authoritative coverage cycles for each department."
        actions={
          <Button onClick={() => openForm(null)}>
            <Plus className="h-4 w-4 mr-2" />
            <span className="font-mono text-xs uppercase tracking-wide">Add Roster Plan</span>
          </Button>
        }
      />

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <InlineField label="Filter by Department">
            <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
              <SelectTrigger>
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                <SelectItem value={SELECT_ALL}>All departments</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          {unitsLoading || isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : plans.length === 0 ? (
            <EmptyState
              icon={CalendarIcon}
              title="No roster plans yet"
              description="Create a plan to define the authoritative coverage cycle."
            />
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Plan</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Department</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Cycle</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Effective</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Status</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.map((plan, index) => (
                    <TableRow
                      key={plan.id}
                      className="animate-chronicle-enter"
                      style={{ animationDelay: `${index * 30}ms` }}
                    >
                      <TableCell>
                        <div className="font-heading font-medium">{plan.name}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                          Version {plan.version}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatRosterName(unitById.get(plan.department)?.name, plan.department_name)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{plan.cycle_length_days} days</TableCell>
                      <TableCell className="font-mono text-xs">
                        {safeDate(plan.effective_from)}
                        {plan.effective_until && (
                          <span className="text-muted-foreground"> → {safeDate(plan.effective_until)}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn('text-[10px] font-mono capitalize', STATUS_BADGE_CLASSES[plan.status] || '')}
                        >
                          {plan.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openForm(plan)}>
                            Edit
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(plan)}>
                            Delete
                          </Button>
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
            <DialogTitle className="font-display text-xl">
              {editingPlan ? 'Edit Roster Plan' : 'Add Roster Plan'}
            </DialogTitle>
            <DialogDescription>
              Define the coverage cycle and effective window.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <InlineField label="Department">
              <Select
                value={formState.department}
                onValueChange={(value) => setFormState((prev) => ({ ...prev, department: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {departments.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InlineField>
            <FieldRow>
              <InlineField label="Plan Name">
                <Input
                  value={formState.name}
                  onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
                />
              </InlineField>
              <InlineField label="Cycle Length (days)">
                <Input
                  type="number"
                  min="1"
                  value={formState.cycle_length_days}
                  onChange={(e) => setFormState((prev) => ({ ...prev, cycle_length_days: e.target.value }))}
                  className="font-mono"
                />
              </InlineField>
            </FieldRow>
            <FieldRow>
              <InlineField label="Effective From">
                <Input
                  type="date"
                  value={formState.effective_from}
                  onChange={(e) => setFormState((prev) => ({ ...prev, effective_from: e.target.value }))}
                  className="font-mono"
                />
              </InlineField>
              <InlineField label="Effective Until (Optional)">
                <Input
                  type="date"
                  value={formState.effective_until}
                  onChange={(e) => setFormState((prev) => ({ ...prev, effective_until: e.target.value }))}
                  className="font-mono"
                />
              </InlineField>
            </FieldRow>
            <FieldRow>
              <InlineField label="Status">
                <Select
                  value={formState.status}
                  onValueChange={(value) => setFormState((prev) => ({ ...prev, status: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[200]">
                    {DUTY_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </InlineField>
              <InlineField label="Version">
                <Input
                  type="number"
                  min="1"
                  value={formState.version}
                  onChange={(e) => setFormState((prev) => ({ ...prev, version: e.target.value }))}
                  className="font-mono"
                />
              </InlineField>
            </FieldRow>
            <InlineField label="Notes (Optional)">
              <Textarea
                value={formState.notes}
                onChange={(e) => setFormState((prev) => ({ ...prev, notes: e.target.value }))}
                rows={3}
              />
            </InlineField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createPlan.isPending || updatePlan.isPending}
            >
              {editingPlan ? 'Save Changes' : 'Create Plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
