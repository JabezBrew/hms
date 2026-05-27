/**
 * RosterPatternsTab - Manage roster patterns
 * Chronicle Design System styling
 */
import { useId, useMemo, useReducer } from 'react';
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

const INITIAL_PAGE_STATE = {
  selectedDepartment: SELECT_ALL,
  requestedPlan: '',
  showInactive: false,
  dialog: {
    isOpen: false,
    pattern: null,
  },
};

const INITIAL_PATTERN_FORM = {
  plan: '',
  name: '',
  display_order: 0,
  is_active: true,
};

function pageReducer(state, action) {
  switch (action.type) {
    case 'select-department':
      return {
        ...state,
        selectedDepartment: action.value,
        requestedPlan: '',
      };
    case 'select-plan':
      return {
        ...state,
        requestedPlan: action.value,
      };
    case 'toggle-inactive':
      return {
        ...state,
        showInactive: !state.showInactive,
      };
    case 'open-create':
      return {
        ...state,
        dialog: {
          isOpen: true,
          pattern: null,
        },
      };
    case 'open-edit':
      return {
        ...state,
        dialog: {
          isOpen: true,
          pattern: action.pattern,
        },
      };
    case 'close-dialog':
      return {
        ...state,
        dialog: {
          isOpen: false,
          pattern: null,
        },
      };
    default:
      return state;
  }
}

function formReducer(state, action) {
  switch (action.type) {
    case 'field':
      return {
        ...state,
        [action.field]: action.value,
      };
    default:
      return state;
  }
}

function pickActivePlan(plans, requestedPlan) {
  if (!plans.length) return '';
  return plans.some((plan) => plan.id === requestedPlan) ? requestedPlan : plans[0].id;
}

function buildPatternForm(pattern, fallbackPlan) {
  if (!pattern) {
    return {
      ...INITIAL_PATTERN_FORM,
      plan: fallbackPlan || '',
    };
  }

  return {
    plan: toValue(pattern.plan),
    name: pattern.name || '',
    display_order: pattern.display_order ?? 0,
    is_active: pattern.is_active ?? true,
  };
}

function RosterPatternFilters({
  departments,
  plans,
  selectedDepartment,
  selectedPlan,
  onDepartmentChange,
  onPlanChange,
}) {
  return (
    <FieldRow>
      <InlineField label="Filter by Department">
        <Select value={selectedDepartment} onValueChange={onDepartmentChange}>
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
        <Select value={selectedPlan} onValueChange={onPlanChange}>
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
  );
}

function RosterPatternsTable({ patterns, planNameById, onEditPattern, onDeletePattern }) {
  return (
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
                {formatRosterName(planNameById.get(pattern.plan))}
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
                  <Button variant="ghost" size="sm" onClick={() => onEditPattern(pattern)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onDeletePattern(pattern)}>
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PatternFormDialog({
  pattern,
  plans,
  fallbackPlan,
  isPending,
  onClose,
  onSubmit,
}) {
  const fieldId = useId();
  const [formState, dispatchForm] = useReducer(
    formReducer,
    { pattern, fallbackPlan },
    ({ pattern: initialPattern, fallbackPlan: initialPlan }) => buildPatternForm(initialPattern, initialPlan)
  );

  const updateField = (field, value) => {
    dispatchForm({ type: 'field', field, value });
  };

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {pattern ? 'Edit Pattern' : 'Add Pattern'}
          </DialogTitle>
          <DialogDescription>
            Patterns group cycle slots within a roster plan.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <InlineField label="Roster Plan">
            <Select
              value={formState.plan}
              onValueChange={(value) => updateField('plan', value)}
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
                onChange={(event) => updateField('name', event.target.value)}
              />
            </InlineField>
            <InlineField label="Display Order">
              <Input
                type="number"
                min="0"
                value={formState.display_order}
                onChange={(event) => updateField('display_order', event.target.value)}
                className="font-mono"
              />
            </InlineField>
          </FieldRow>
          <InlineField label="Status">
            <div className="pt-2">
              <label htmlFor={`${fieldId}-pattern-active`} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  id={`${fieldId}-pattern-active`}
                  checked={formState.is_active}
                  onCheckedChange={(value) => updateField('is_active', Boolean(value))}
                />
                <span className="text-sm">Active</span>
              </label>
            </div>
          </InlineField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit(formState, pattern)}
            disabled={isPending}
          >
            {pattern ? 'Save Changes' : 'Create Pattern'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RosterPatternsTab() {
  const { isLoading: unitsLoading, departments } = useUnitOptions();
  const [pageState, dispatchPage] = useReducer(pageReducer, INITIAL_PAGE_STATE);
  const { selectedDepartment, requestedPlan, showInactive, dialog } = pageState;

  const departmentFilter = selectedDepartment === SELECT_ALL ? undefined : selectedDepartment;

  const { data: plansData } = useDepartmentRosterPlans({ department: departmentFilter });
  const plans = toList(plansData);
  const selectedPlan = pickActivePlan(plans, requestedPlan);
  const planNameById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan.name])), [plans]);

  const { data: patternsData, isLoading } = useDepartmentRosterPatterns({
    plan: selectedPlan || undefined,
    include_inactive: showInactive ? 'true' : undefined,
  });
  const patterns = toList(patternsData);

  const createPattern = useCreateDepartmentRosterPattern();
  const updatePattern = useUpdateDepartmentRosterPattern();
  const deletePattern = useDeleteDepartmentRosterPattern();

  const openForm = (pattern) => {
    dispatchPage(pattern ? { type: 'open-edit', pattern } : { type: 'open-create' });
  };

  const handleSubmit = async (formState, pattern) => {
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
      if (pattern) {
        await updatePattern.mutateAsync({ id: pattern.id, data: payload });
        toast.success('Pattern updated.');
      } else {
        await createPattern.mutateAsync(payload);
        toast.success('Pattern created.');
      }
      dispatchPage({ type: 'close-dialog' });
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
              onClick={() => dispatchPage({ type: 'toggle-inactive' })}
              className="font-mono text-xs"
            >
              {showInactive ? 'Hide Inactive' : 'Show Inactive'}
            </Button>
            <Button onClick={() => openForm(null)}>
              <Plus className="size-4 mr-2" />
              <span className="font-mono text-xs uppercase tracking-wide">Add Pattern</span>
            </Button>
          </>
        }
      />

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <RosterPatternFilters
            departments={departments}
            plans={plans}
            selectedDepartment={selectedDepartment}
            selectedPlan={selectedPlan}
            onDepartmentChange={(value) => dispatchPage({ type: 'select-department', value })}
            onPlanChange={(value) => dispatchPage({ type: 'select-plan', value })}
          />

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
            <RosterPatternsTable
              patterns={patterns}
              planNameById={planNameById}
              onEditPattern={openForm}
              onDeletePattern={handleDelete}
            />
          )}
        </CardContent>
      </Card>

      {dialog.isOpen ? (
        <PatternFormDialog
          key={dialog.pattern?.id || `new-${selectedPlan || 'none'}`}
          pattern={dialog.pattern}
          plans={plans}
          fallbackPlan={selectedPlan}
          isPending={createPattern.isPending || updatePattern.isPending}
          onClose={() => dispatchPage({ type: 'close-dialog' })}
          onSubmit={handleSubmit}
        />
      ) : null}
    </div>
  );
}
