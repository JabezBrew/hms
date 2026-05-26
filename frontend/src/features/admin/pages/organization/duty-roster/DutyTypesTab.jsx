/**
 * DutyTypesTab - Manage department duty types
 * Chronicle Design System styling
 */
import { useId, useState, useEffect } from 'react';
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

export function DutyTypesTab() {
  const fieldId = useId();
  const { isLoading: unitsLoading, departments, unitById } = useUnitOptions();
  const [selectedDepartment, setSelectedDepartment] = useState(SELECT_ALL);
  const [showInactive, setShowInactive] = useState(false);
  const [editingDutyType, setEditingDutyType] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const departmentFilter = selectedDepartment === SELECT_ALL ? undefined : selectedDepartment;

  const { data: dutyTypeData, isLoading } = useDepartmentDutyTypes({
    department: departmentFilter,
    include_inactive: showInactive ? 'true' : undefined,
  });
  const dutyTypes = toList(dutyTypeData);

  const createDutyType = useCreateDepartmentDutyType();
  const updateDutyType = useUpdateDepartmentDutyType();
  const deleteDutyType = useDeleteDepartmentDutyType();

  const [formState, setFormState] = useState({
    name: '',
    code: '',
    department: '',
    default_context: DUTY_CONTEXT_OPTIONS[0].value,
    default_role: DUTY_ROLE_OPTIONS[0].value,
    default_context_label: '',
    default_role_label: '',
    requires_time_range: false,
    display_order: 0,
    is_active: true,
  });

  useEffect(() => {
    if (!showForm) {
      setEditingDutyType(null);
      setFormState({
        name: '',
        code: '',
        department: departmentFilter || '',
        default_context: DUTY_CONTEXT_OPTIONS[0].value,
        default_role: DUTY_ROLE_OPTIONS[0].value,
        default_context_label: '',
        default_role_label: '',
        requires_time_range: false,
        display_order: 0,
        is_active: true,
      });
    }
  }, [showForm, selectedDepartment]);

  const openForm = (dutyType) => {
    if (dutyType) {
      setEditingDutyType(dutyType);
      setFormState({
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
      });
    } else {
      setEditingDutyType(null);
      setFormState((prev) => ({
        ...prev,
        department: departmentFilter || prev.department,
      }));
    }
    setShowForm(true);
  };

  const handleSubmit = async () => {
    try {
      const payload = {
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
      if (!payload.name || !payload.code || !payload.department) {
        toast.error('Name, code, and department are required.');
        return;
      }
      if (editingDutyType) {
        await updateDutyType.mutateAsync({ id: editingDutyType.id, data: payload });
        toast.success('Duty type updated.');
      } else {
        await createDutyType.mutateAsync(payload);
        toast.success('Duty type created.');
      }
      setShowForm(false);
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
              onClick={() => setShowInactive((prev) => !prev)}
              className="font-mono text-xs"
            >
              {showInactive ? 'Hide Inactive' : 'Show Inactive'}
            </Button>
            <Button onClick={() => openForm(null)}>
              <Plus className="size-4 mr-2" />
              <span className="font-mono text-xs uppercase tracking-wide">Add Duty Type</span>
            </Button>
          </>
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
          ) : dutyTypes.length === 0 ? (
            <EmptyState
              icon={Clipboard}
              title="No duty types yet"
              description="Add duty types to define coverage labels for each department."
            />
          ) : (
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
                    <TableRow
                      key={dutyType.id}
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
                          <Button variant="ghost" size="sm" onClick={() => openForm(dutyType)}>
                            Edit
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(dutyType)}>
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
                <Input
                  value={formState.name}
                  onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
                />
              </InlineField>
              <InlineField label="Code">
                <Input
                  value={formState.code}
                  onChange={(e) => setFormState((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                  className="font-mono"
                />
              </InlineField>
            </FieldRow>
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
              <InlineField label="Default Role">
                <Select
                  value={formState.default_role}
                  onValueChange={(value) => setFormState((prev) => ({ ...prev, default_role: value }))}
                >
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
                <Select
                  value={formState.default_context}
                  onValueChange={(value) => setFormState((prev) => ({ ...prev, default_context: value }))}
                >
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
                  onChange={(e) => setFormState((prev) => ({ ...prev, default_role_label: e.target.value }))}
                  placeholder="Custom label"
                />
              </InlineField>
              <InlineField label="Context Label (Optional)">
                <Input
                  value={formState.default_context_label}
                  onChange={(e) => setFormState((prev) => ({ ...prev, default_context_label: e.target.value }))}
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
                  onChange={(e) => setFormState((prev) => ({ ...prev, display_order: e.target.value }))}
                  className="font-mono"
                />
              </InlineField>
              <InlineField label="Options">
                <div className="space-y-3 pt-2">
                  <label htmlFor={`${fieldId}-requires-time-range`} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      id={`${fieldId}-requires-time-range`}
                      checked={formState.requires_time_range}
                      onCheckedChange={(value) => setFormState((prev) => ({ ...prev, requires_time_range: Boolean(value) }))}
                    />
                    <span className="text-sm">Requires time range</span>
                  </label>
                  <label htmlFor={`${fieldId}-duty-type-active`} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      id={`${fieldId}-duty-type-active`}
                      checked={formState.is_active}
                      onCheckedChange={(value) => setFormState((prev) => ({ ...prev, is_active: Boolean(value) }))}
                    />
                    <span className="text-sm">Active</span>
                  </label>
                </div>
              </InlineField>
            </FieldRow>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createDutyType.isPending || updateDutyType.isPending}
            >
              {editingDutyType ? 'Save Changes' : 'Create Duty Type'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
