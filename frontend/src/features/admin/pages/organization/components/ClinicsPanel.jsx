/**
 * ClinicsPanel - Manages clinics for a department
 * Used in OrganizationPage unit detail view
 */
import { useState } from 'react';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  useClinics,
  useCreateClinic,
  useUpdateClinic,
  useDeleteClinic,
} from '@/features/admin/hooks';

/**
 * ClinicsPanel - Displays and manages clinics for a unit (department)
 */
export function ClinicsPanel({ unitId, unitType }) {
  const [showForm, setShowForm] = useState(false);
  const [editingClinic, setEditingClinic] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Only departments can have clinics
  const canHaveClinics = unitType === 'department' || unitType === 'division';

  const { data: clinicsData, isLoading } = useClinics(
    { department: unitId, is_active: true },
    { enabled: canHaveClinics && !!unitId }
  );
  const clinics = Array.isArray(clinicsData) ? clinicsData : (clinicsData?.results || []);

  const createMutation = useCreateClinic();
  const updateMutation = useUpdateClinic();
  const deleteMutation = useDeleteClinic();

  const [formState, setFormState] = useState({
    code: '',
    name: '',
    description: '',
    operating_hours_start: '08:00',
    operating_hours_end: '17:00',
    operates_24_hours: false,
    accepts_walk_ins: true,
    is_active: true,
  });

  const openForm = (clinic = null) => {
    if (clinic) {
      setEditingClinic(clinic);
      setFormState({
        code: clinic.code || '',
        name: clinic.name || '',
        description: clinic.description || '',
        operating_hours_start: clinic.operating_hours_start?.slice(0, 5) || '08:00',
        operating_hours_end: clinic.operating_hours_end?.slice(0, 5) || '17:00',
        operates_24_hours: clinic.operates_24_hours || false,
        accepts_walk_ins: clinic.accepts_walk_ins ?? true,
        is_active: clinic.is_active ?? true,
      });
    } else {
      setEditingClinic(null);
      setFormState({
        code: '',
        name: '',
        description: '',
        operating_hours_start: '08:00',
        operating_hours_end: '17:00',
        operates_24_hours: false,
        accepts_walk_ins: true,
        is_active: true,
      });
    }
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!formState.name.trim() || !formState.code.trim()) {
      toast.error('Name and code are required.');
      return;
    }

    const payload = {
      department: unitId,
      code: formState.code.trim().toUpperCase(),
      name: formState.name.trim(),
      description: formState.description.trim(),
      operating_hours_start: formState.operates_24_hours ? null : formState.operating_hours_start,
      operating_hours_end: formState.operates_24_hours ? null : formState.operating_hours_end,
      operates_24_hours: formState.operates_24_hours,
      accepts_walk_ins: formState.accepts_walk_ins,
      is_active: formState.is_active,
    };

    try {
      if (editingClinic) {
        await updateMutation.mutateAsync({ id: editingClinic.id, data: payload });
        toast.success('Clinic updated successfully.');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('Clinic created successfully.');
      }
      setShowForm(false);
      setEditingClinic(null);
    } catch (error) {
      const message = error.response?.data?.detail || error.message || 'Failed to save clinic.';
      toast.error(message);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteMutation.mutateAsync(deleteConfirm.id);
      toast.success('Clinic deleted successfully.');
      setDeleteConfirm(null);
    } catch (error) {
      toast.error(error.message || 'Failed to delete clinic.');
    }
  };

  if (!canHaveClinics) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50 mb-4">
          <Stethoscope className="h-7 w-7 text-muted-foreground/50" />
        </div>
        <p className="text-sm text-muted-foreground">
          Clinics can only be added to departments or divisions
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Outpatient Clinics
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Clinics can be linked to duty types for appointment scheduling
          </p>
        </div>
        <Button onClick={() => openForm()} size="sm" className="font-mono text-xs">
          <Plus className="h-4 w-4 mr-1" />
          Add Clinic
        </Button>
      </div>

      {clinics.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed rounded-lg">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50 mb-3">
            <Stethoscope className="h-6 w-6 text-muted-foreground/50" />
          </div>
          <p className="text-sm text-muted-foreground">No clinics configured</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add clinics to enable outpatient appointment scheduling
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {clinics.map((clinic) => (
            <div
              key={clinic.id}
              className="flex items-center justify-between p-4 rounded-lg border bg-card hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <Stethoscope className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-heading font-medium">{clinic.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {clinic.code}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {clinic.operates_24_hours
                        ? '24 hours'
                        : clinic.operating_hours_start && clinic.operating_hours_end
                          ? `${clinic.operating_hours_start.slice(0, 5)} - ${clinic.operating_hours_end.slice(0, 5)}`
                          : 'Hours not set'}
                    </span>
                    {clinic.accepts_walk_ins && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                        Walk-ins
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px]',
                    clinic.is_active
                      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {clinic.is_active ? 'Active' : 'Inactive'}
                </Badge>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openForm(clinic)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeleteConfirm(clinic)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Clinic Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editingClinic ? 'Edit Clinic' : 'Add Clinic'}
            </DialogTitle>
            <DialogDescription>
              Configure an outpatient clinic for this department.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Name *
                </label>
                <Input
                  value={formState.name}
                  onChange={(e) => setFormState((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Cardiology Clinic"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Code *
                </label>
                <Input
                  value={formState.code}
                  onChange={(e) => setFormState((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                  placeholder="CARDIO"
                  className="font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Description
              </label>
              <Textarea
                value={formState.description}
                onChange={(e) => setFormState((p) => ({ ...p, description: e.target.value }))}
                placeholder="Brief description of the clinic..."
                rows={2}
              />
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={formState.operates_24_hours}
                  onCheckedChange={(v) => setFormState((p) => ({ ...p, operates_24_hours: Boolean(v) }))}
                />
                <span className="text-sm">24-hour operation</span>
              </label>

              {!formState.operates_24_hours && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                      Opening Time
                    </label>
                    <Input
                      type="time"
                      value={formState.operating_hours_start}
                      onChange={(e) => setFormState((p) => ({ ...p, operating_hours_start: e.target.value }))}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                      Closing Time
                    </label>
                    <Input
                      type="time"
                      value={formState.operating_hours_end}
                      onChange={(e) => setFormState((p) => ({ ...p, operating_hours_end: e.target.value }))}
                      className="font-mono"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-6 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={formState.accepts_walk_ins}
                  onCheckedChange={(v) => setFormState((p) => ({ ...p, accepts_walk_ins: Boolean(v) }))}
                />
                <span className="text-sm">Accepts walk-ins</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={formState.is_active}
                  onCheckedChange={(v) => setFormState((p) => ({ ...p, is_active: Boolean(v) }))}
                />
                <span className="text-sm">Active</span>
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="font-mono text-xs">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="font-mono text-xs"
            >
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save Clinic'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Clinic</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <span className="font-medium">{deleteConfirm?.name}</span>?
              This may affect linked duty types and scheduled appointments.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono text-xs"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default ClinicsPanel;
