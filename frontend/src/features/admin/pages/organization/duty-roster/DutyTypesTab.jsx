/**
 * DutyTypesTab - Manage department duty types
 * Chronicle Design System styling
 */
import { useId, useState } from 'react';
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
import Clipboard from 'lucide-react/dist/esm/icons/clipboard.js';
import { toast } from 'sonner';
import {
  useDepartmentDutyTypes,
  useCreateDepartmentDutyType,
  useUpdateDepartmentDutyType,
  useDeleteDepartmentDutyType,
} from '@/features/admin/hooks';
import { toList, toValue, formatRosterName } from './utils';
import { DUTY_CONTEXT_OPTIONS, DUTY_ROLE_OPTIONS, SELECT_ALL } from './constants';
import { useUnitOptions } from './useUnitOptions';
import { EmptyState, RosterHeader, InlineField, FieldRow } from './components';

function createBlankDutyTypeForm(department = '') {
  return {
    name: '',
    code: '',
    department,
    default_context: DUTY_CONTEXT_OPTIONS[0].value,
    default_role: DUTY_ROLE_OPTIONS[0].value,
    default_context_label: '',
    default_role_label: '',
    requires_time_range: false,
    display_order: 0,
    is_active: true,
  };
}

function createEditDutyTypeForm(dutyType) {
  return {
    name: dutyType.name || '',
    code: dutyType.code || '',
    department: toValue(dutyType.department),
    default_context: dutyType.default_context || DUTY_CONTEXT_OPTIONS[0].value,
    default_role: dutyType.default_role || DUTY_ROLE_OPTIONS[0].value,
    default_context_label: dutyType.default_context_label || '',
    default_role_label: dutyType.default_role_label || '',
    requires_time_range: !!dutyType.requires_time_range,
    display_order: dutyType.display_order ?? 0,
    is_active: dutyType.is_active ?? true,
  };
}

function buildDutyTypePayload(formState) {
  return {
    name: formState.name.trim(),
    code: formState.code.trim(),
    department: formState.department,
    default_context: formState.default_context,
    default_role: formState.default_role,
    default_context_label: formState.default_context_label.trim() || null,
    default_role_label: formState.default_role_label.trim() || null,
    requires_time_range: formState.requires_time_range,
    display_order: Number(formState.display_order) || 0,
    is_active: !!formState.is_active,
  };
}

export function DutyTypesTab() {
  const fieldId = useId();
  const { isLoading: unitsLoading, departments, unitById } = useUnitOptions();
  const [selectedDepartment, setSelectedDepartment] = useState(SELECT_ALL);
  const [showInactive, setShowInactive] = useState(false);
  const [formDraft, setFormDraft] = useState(null);

  const departmentFilter = selectedDepartment === SELECT_ALL ? undefined : selectedDepartment;

  const { data: dutyTypeData, isLoading } = useDepartmentDutyTypes({
    department: departmentFilter,
    include_inactive: showInactive ? 'true' : undefined,
  });
  const dutyTypes = toList(dutyTypeData);

  const createDutyType = useCreateDepartmentDutyType();
  const updateDutyType = useUpdateDepartmentDutyType();
  const deleteDutyType = useDeleteDepartmentDutyType();

  const formState = formDraft?.values || createBlankDutyTypeForm(departmentFilter || '');
  const editingDutyType = formDraft?.dutyType || null;
  const isFormOpen = formDraft !== null;
  const isSaving = createDutyType.isPending || updateDutyType.isPending;

  const handleToggleInactive = () => {
    setShowInactive((prev) => !prev);
  };

  const handleCreateClick = () => {
    setFormDraft({
      dutyType: null,
      values: createBlankDutyTypeForm(departmentFilter || ''),
    });
  };

  const handleEditDutyType = (dutyType) => {
    setFormDraft({
      dutyType,
      values: createEditDutyTypeForm(dutyType),
    });
  };

  const handleDialogOpenChange = (open) => {
    if (!open) {
      setFormDraft(null);
    }
  };

  const handleFormFieldChange = (field, value) => {
    setFormDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        values: {
          ...prev.values,
          [field]: value,
        },
      };
    });
  };

  const handleSubmit = async () => {
    if (!formDraft) return;

    try {
      const payload = buildDutyTypePayload(formDraft.values);
      if (!payload.name || !payload.code || !payload.department) {
        toast.error('Name, code, and department are required.');
        return;
      }
      if (formDraft.dutyType) {
        await updateDutyType.mutateAsync({ id: formDraft.dutyType.id, data: payload });
        toast.success('Duty type updated.');
      } else {
        await createDutyType.mutateAsync(payload);
        toast.success('Duty type created.');
      }
      setFormDraft(null);
    } catch (error) {
      toast.error(error.message || 'Failed to save duty type.');
    }
  };

  const handleDelete = async (dutyType) => {
    if (!confirm('Delete this duty type?')) return;
    try {
      await deleteDutyType.mutateAsync(dutyType.id);
      toast.success('Duty type deleted.');
    } catch (error) {
      toast.error(error.message || 'Failed to delete duty type.');
    }
  };

  return (
    <div className="space-y-6">
      <RosterHeader
        title="Department Duty Types"
        subtitle="Configure department-specific duty labels and defaults."
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleToggleInactive}
              className="font-mono text-xs"
            >
              {showInactive ? 'Hide Inactive' : 'Show Inactive'}
            </Button>
            <Button onClick={handleCreateClick}>
              <Plus className="size-4 mr-2" />
              <span className="font-mono text-xs uppercase tracking-wide">Add Duty Type</span>
            </Button>
          </>
        }
      />

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <DepartmentFilter
            selectedDepartment={selectedDepartment}
            departments={departments}
            onDepartmentChange={setSelectedDepartment}
          />
          <DutyTypesList
            unitsLoading={unitsLoading}
            dutyTypesLoading={isLoading}
            dutyTypes={dutyTypes}
            unitById={unitById}
            onEditDutyType={handleEditDutyType}
            onDeleteDutyType={handleDelete}
          />
        </CardContent>
      </Card>

      <DutyTypeFormDialog
        fieldId={fieldId}
        open={isFormOpen}
        editingDutyType={editingDutyType}
        formState={formState}
        departments={departments}
        isSaving={isSaving}
        onOpenChange={handleDialogOpenChange}
        onSubmit={handleSubmit}
        onFieldChange={handleFormFieldChange}
      />
    </div>
  );
}

function DepartmentFilter({ selectedDepartment, departments, onDepartmentChange }) {
  return (
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
  );
}

function DutyTypesList({
  unitsLoading,
  dutyTypesLoading,
  dutyTypes,
  unitById,
  onEditDutyType,
  onDeleteDutyType,
}) {
  if (unitsLoading || dutyTypesLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (dutyTypes.length === 0) {
    return (
      <EmptyState
        icon={Clipboard}
        title="No duty types yet"
        description="Add duty types to define coverage labels for each department."
      />
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Duty Type</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Code</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Department</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Defaults</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Timing</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Status</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {dutyTypes.map((dutyType, index) => (
            <DutyTypeRow
              key={dutyType.id}
              dutyType={dutyType}
              index={index}
              unitById={unitById}
              onEditDutyType={onEditDutyType}
              onDeleteDutyType={onDeleteDutyType}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DutyTypeRow({ dutyType, index, unitById, onEditDutyType, onDeleteDutyType }) {
  const handleEditClick = () => {
    onEditDutyType(dutyType);
  };

  const handleDeleteClick = () => {
    onDeleteDutyType(dutyType);
  };

  return (
    <TableRow
      className="animate-chronicle-enter"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <TableCell>
        <div className="font-heading font-medium">{dutyType.name}</div>
        <div className="text-[10px] font-mono text-muted-foreground">
          Order {dutyType.display_order ?? 0}
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">{dutyType.code}</TableCell>
      <TableCell className="text-sm">
        {formatRosterName(unitById.get(dutyType.department)?.name, dutyType.department_name)}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className="text-[10px] font-mono">
            {dutyType.default_role_label || dutyType.default_role}
          </Badge>
          <Badge variant="outline" className="text-[10px] font-mono">
            {dutyType.default_context_label || dutyType.default_context}
          </Badge>
        </div>
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={cn(
            'text-[10px] font-mono',
            dutyType.requires_time_range
              ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20'
              : ''
          )}
        >
          {dutyType.requires_time_range ? 'Time-based' : 'Day-based'}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={cn(
            'text-[10px] font-mono',
            dutyType.is_active
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {dutyType.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={handleEditClick}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDeleteClick}>
            Delete
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function DutyTypeFormDialog({
  fieldId,
  open,
  editingDutyType,
  formState,
  departments,
  isSaving,
  onOpenChange,
  onSubmit,
  onFieldChange,
}) {
  const handleNameChange = (event) => {
    onFieldChange('name', event.target.value);
  };

  const handleCodeChange = (event) => {
    onFieldChange('code', event.target.value.toUpperCase());
  };

  const handleDepartmentChange = (value) => {
    onFieldChange('department', value);
  };

  const handleDefaultRoleChange = (value) => {
    onFieldChange('default_role', value);
  };

  const handleDefaultContextChange = (value) => {
    onFieldChange('default_context', value);
  };

  const handleRoleLabelChange = (event) => {
    onFieldChange('default_role_label', event.target.value);
  };

  const handleContextLabelChange = (event) => {
    onFieldChange('default_context_label', event.target.value);
  };

  const handleDisplayOrderChange = (event) => {
    onFieldChange('display_order', event.target.value);
  };

  const handleRequiresTimeRangeChange = (value) => {
    onFieldChange('requires_time_range', Boolean(value));
  };

  const handleActiveChange = (value) => {
    onFieldChange('is_active', Boolean(value));
  };

  const handleCancelClick = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {editingDutyType ? 'Edit Duty Type' : 'Add Duty Type'}
          </DialogTitle>
          <DialogDescription>
            Configure department duty labels and default context.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <FieldRow>
            <InlineField label="Name">
              <Input value={formState.name} onChange={handleNameChange} />
            </InlineField>
            <InlineField label="Code">
              <Input
                value={formState.code}
                onChange={handleCodeChange}
                className="font-mono"
              />
            </InlineField>
          </FieldRow>
          <InlineField label="Department">
            <Select value={formState.department} onValueChange={handleDepartmentChange}>
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
            <InlineField label="Default Role">
              <Select value={formState.default_role} onValueChange={handleDefaultRoleChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {DUTY_ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InlineField>
            <InlineField label="Default Context">
              <Select value={formState.default_context} onValueChange={handleDefaultContextChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {DUTY_CONTEXT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InlineField>
          </FieldRow>
          <FieldRow>
            <InlineField label="Role Label (Optional)">
              <Input
                value={formState.default_role_label}
                onChange={handleRoleLabelChange}
                placeholder="Custom label"
              />
            </InlineField>
            <InlineField label="Context Label (Optional)">
              <Input
                value={formState.default_context_label}
                onChange={handleContextLabelChange}
                placeholder="Custom label"
              />
            </InlineField>
          </FieldRow>
          <FieldRow>
            <InlineField label="Display Order">
              <Input
                type="number"
                min="0"
                value={formState.display_order}
                onChange={handleDisplayOrderChange}
                className="font-mono"
              />
            </InlineField>
            <InlineField label="Options">
              <div className="space-y-3 pt-2">
                <label htmlFor={`${fieldId}-requires-time-range`} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    id={`${fieldId}-requires-time-range`}
                    checked={formState.requires_time_range}
                    onCheckedChange={handleRequiresTimeRangeChange}
                  />
                  <span className="text-sm">Requires time range</span>
                </label>
                <label htmlFor={`${fieldId}-duty-type-active`} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    id={`${fieldId}-duty-type-active`}
                    checked={formState.is_active}
                    onCheckedChange={handleActiveChange}
                  />
                  <span className="text-sm">Active</span>
                </label>
              </div>
            </InlineField>
          </FieldRow>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancelClick}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isSaving}>
            {editingDutyType ? 'Save Changes' : 'Create Duty Type'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
