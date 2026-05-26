/**
 * StationsTab - Manage department stations
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
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import { toast } from 'sonner';
import {
  useDepartmentStations,
  useCreateDepartmentStation,
  useUpdateDepartmentStation,
  useDeleteDepartmentStation,
} from '@/features/admin/hooks';
import { toList, toValue, formatRosterName } from './utils';
import { SELECT_ALL } from './constants';
import { useUnitOptions } from './useUnitOptions';
import { EmptyState, RosterHeader, InlineField, FieldRow } from './components';

export function StationsTab() {
  const fieldId = useId();
  const { isLoading: unitsLoading, departments, unitById } = useUnitOptions();
  const [selectedDepartment, setSelectedDepartment] = useState(SELECT_ALL);
  const [showInactive, setShowInactive] = useState(false);
  const [editingStation, setEditingStation] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const departmentFilter = selectedDepartment === SELECT_ALL ? undefined : selectedDepartment;

  const { data: stationsData, isLoading } = useDepartmentStations({
    department: departmentFilter,
    include_inactive: showInactive ? 'true' : undefined,
  });
  const stations = toList(stationsData);

  const createStation = useCreateDepartmentStation();
  const updateStation = useUpdateDepartmentStation();
  const deleteStation = useDeleteDepartmentStation();

  const [formState, setFormState] = useState({
    name: '',
    code: '',
    department: '',
    display_order: 0,
    is_active: true,
  });

  useEffect(() => {
    if (!showForm) {
      setEditingStation(null);
      setFormState({
        name: '',
        code: '',
        department: departmentFilter || '',
        display_order: 0,
        is_active: true,
      });
    }
  }, [showForm, selectedDepartment]);

  const openForm = (station) => {
    if (station) {
      setEditingStation(station);
      setFormState({
        name: station.name || '',
        code: station.code || '',
        department: toValue(station.department),
        display_order: station.display_order ?? 0,
        is_active: station.is_active ?? true,
      });
    } else {
      setEditingStation(null);
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
        name: formState.name.trim(),
        code: formState.code.trim(),
        department: formState.department,
        display_order: Number(formState.display_order) || 0,
        is_active: !!formState.is_active,
      };
      if (!payload.name || !payload.code || !payload.department) {
        toast.error('Name, code, and department are required.');
        return;
      }
      if (editingStation) {
        await updateStation.mutateAsync({ id: editingStation.id, data: payload });
        toast.success('Station updated.');
      } else {
        await createStation.mutateAsync(payload);
        toast.success('Station created.');
      }
      setShowForm(false);
    } catch (error) {
      toast.error(error.message || 'Failed to save station.');
    }
  };

  const handleDelete = async (station) => {
    if (!confirm('Delete this station?')) return;
    try {
      await deleteStation.mutateAsync(station.id);
      toast.success('Station deleted.');
    } catch (error) {
      toast.error(error.message || 'Failed to delete station.');
    }
  };

  return (
    <div className="space-y-6">
      <RosterHeader
        title="Department Stations"
        subtitle="Maintain physical locations or service points per department."
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
              <span className="font-mono text-xs uppercase tracking-wide">Add Station</span>
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
          ) : stations.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title="No stations configured"
              description="Add stations to represent physical locations or service points."
            />
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Station</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Code</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Department</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Order</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Status</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stations.map((station, index) => (
                    <TableRow
                      key={station.id}
                      className="animate-chronicle-enter"
                      style={{ animationDelay: `${index * 30}ms` }}
                    >
                      <TableCell className="font-heading font-medium">{station.name}</TableCell>
                      <TableCell className="font-mono text-xs">{station.code}</TableCell>
                      <TableCell className="text-sm">
                        {formatRosterName(unitById.get(station.department)?.name, station.department_name)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{station.display_order ?? 0}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] font-mono',
                            station.is_active
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                              : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {station.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openForm(station)}>
                            Edit
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(station)}>
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
              {editingStation ? 'Edit Station' : 'Add Station'}
            </DialogTitle>
            <DialogDescription>
              Stations are physical locations tied to team roster entries.
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
              <InlineField label="Display Order">
                <Input
                  type="number"
                  min="0"
                  value={formState.display_order}
                  onChange={(e) => setFormState((prev) => ({ ...prev, display_order: e.target.value }))}
                  className="font-mono"
                />
              </InlineField>
              <InlineField label="Status">
                <div className="pt-2">
                  <label htmlFor={`${fieldId}-station-active`} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      id={`${fieldId}-station-active`}
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
              disabled={createStation.isPending || updateStation.isPending}
            >
              {editingStation ? 'Save Changes' : 'Create Station'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
