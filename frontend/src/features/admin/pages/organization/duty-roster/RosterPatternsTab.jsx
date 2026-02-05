/**
 * RosterPatternsTab - Manage roster patterns
 * Chronicle Design System styling
 */
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
import Layers from 'lucide-react/dist/esm/icons/layers.js';
import { toast } from 'sonner';
import {
  useDepartmentRosterPlans,
  useDepartmentRosterPatterns,
  useCreateDepartmentRosterPattern,
  useUpdateDepartmentRosterPattern,
  useDeleteDepartmentRosterPattern,
} from '@/features/admin/hooks';
import { toList, toValue, formatRosterName } from './utils';
import { SELECT_ALL } from './constants';
import { useUnitOptions } from './useUnitOptions';
import { EmptyState, RosterHeader, InlineField, FieldRow } from './components';

export function RosterPatternsTab() {
  const { isLoading: unitsLoading, departments } = useUnitOptions();
  const [selectedDepartment, setSelectedDepartment] = useState(SELECT_ALL);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editingPattern, setEditingPattern] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const departmentFilter = selectedDepartment === SELECT_ALL ? undefined : selectedDepartment;

  const { data: plansData } = useDepartmentRosterPlans({ department: departmentFilter });
  const plans = toList(plansData);

  const { data: patternsData, isLoading } = useDepartmentRosterPatterns({
    plan: selectedPlan || undefined,
    include_inactive: showInactive ? 'true' : undefined,
  });
  const patterns = toList(patternsData);

  const createPattern = useCreateDepartmentRosterPattern();
  const updatePattern = useUpdateDepartmentRosterPattern();
  const deletePattern = useDeleteDepartmentRosterPattern();

  const [formState, setFormState] = useState({
    plan: '',
    name: '',
    display_order: 0,
    is_active: true,
  });

  useEffect(() => {
    if (!showForm) {
      setEditingPattern(null);
      setFormState({
        plan: selectedPlan || '',
        name: '',
        display_order: 0,
        is_active: true,
      });
    }
  }, [showForm, selectedPlan]);

  useEffect(() => {
    if (!plans.length) {
      setSelectedPlan('');
      return;
    }
    if (!selectedPlan || !plans.some((plan) => plan.id === selectedPlan)) {
      setSelectedPlan(plans[0].id);
    }
  }, [plans, selectedPlan]);

  const openForm = (pattern) => {
    if (pattern) {
      setEditingPattern(pattern);
      setFormState({
        plan: toValue(pattern.plan),
        name: pattern.name || '',
        display_order: pattern.display_order ?? 0,
        is_active: pattern.is_active ?? true,
      });
    } else {
      setEditingPattern(null);
      setFormState((prev) => ({
        ...prev,
        plan: selectedPlan || prev.plan,
      }));
    }
    setShowForm(true);
  };

  const handleSubmit = async () => {
    try {
      const payload = {
        plan: formState.plan,
        name: formState.name.trim(),
        display_order: Number(formState.display_order) || 0,
        is_active: !!formState.is_active,
      };
      if (!payload.plan || !payload.name) {
        toast.error('Plan and name are required.');
        return;
      }
      if (editingPattern) {
        await updatePattern.mutateAsync({ id: editingPattern.id, data: payload });
        toast.success('Pattern updated.');
      } else {
        await createPattern.mutateAsync(payload);
        toast.success('Pattern created.');
      }
      setShowForm(false);
    } catch (error) {
      toast.error(error.message || 'Failed to save pattern.');
    }
  };

  const handleDelete = async (pattern) => {
    if (!confirm('Delete this pattern?')) return;
    try {
      await deletePattern.mutateAsync(pattern.id);
      toast.success('Pattern deleted.');
    } catch (error) {
      toast.error(error.message || 'Failed to delete pattern.');
    }
  };

  return (
    <div className="space-y-6">
      <RosterHeader
        title="Roster Patterns"
        subtitle="Organize multiple patterns within each roster plan."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setShowInactive((prev) => !prev)}
              className="font-mono text-xs"
            >
              {showInactive ? 'Hide Inactive' : 'Show Inactive'}
            </Button>
            <Button onClick={() => openForm(null)}>
              <Plus className="h-4 w-4 mr-2" />
              <span className="font-mono text-xs uppercase tracking-wide">Add Pattern</span>
            </Button>
          </>
        }
      />

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <FieldRow>
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
            <InlineField label="Roster Plan">
              <Select value={selectedPlan} onValueChange={setSelectedPlan}>
                <SelectTrigger>
                  <SelectValue placeholder="Select roster plan" />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InlineField>
          </FieldRow>

          {unitsLoading || isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : patterns.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No patterns yet"
              description="Add a pattern to group cycle slots within a plan."
            />
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Pattern</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Plan</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Order</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Status</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patterns.map((pattern, index) => (
                    <TableRow
                      key={pattern.id}
                      className="animate-chronicle-enter"
                      style={{ animationDelay: `${index * 30}ms` }}
                    >
                      <TableCell className="font-heading font-medium">{pattern.name}</TableCell>
                      <TableCell className="text-sm">
                        {formatRosterName(plans.find((plan) => plan.id === pattern.plan)?.name)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{pattern.display_order ?? 0}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] font-mono',
                            pattern.is_active
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                              : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {pattern.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openForm(pattern)}>
                            Edit
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(pattern)}>
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editingPattern ? 'Edit Pattern' : 'Add Pattern'}
            </DialogTitle>
            <DialogDescription>
              Patterns group cycle slots within a roster plan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <InlineField label="Roster Plan">
              <Select
                value={formState.plan}
                onValueChange={(value) => setFormState((prev) => ({ ...prev, plan: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select roster plan" />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InlineField>
            <FieldRow>
              <InlineField label="Pattern Name">
                <Input
                  value={formState.name}
                  onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
                />
              </InlineField>
              <InlineField label="Display Order">
                <Input
                  type="number"
                  min="0"
                  value={formState.display_order}
                  onChange={(e) => setFormState((prev) => ({ ...prev, display_order: e.target.value }))}
                  className="font-mono"
                />
              </InlineField>
            </FieldRow>
            <InlineField label="Status">
              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={formState.is_active}
                    onCheckedChange={(value) => setFormState((prev) => ({ ...prev, is_active: Boolean(value) }))}
                  />
                  <span className="text-sm">Active</span>
                </label>
              </div>
            </InlineField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createPattern.isPending || updatePattern.isPending}
            >
              {editingPattern ? 'Save Changes' : 'Create Pattern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
