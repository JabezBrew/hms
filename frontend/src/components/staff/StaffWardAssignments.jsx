import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Plus,
  Building2,
  Star,
  Trash2,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import {
  usePractitionerAssignments,
  useWards,
  useStaffRoles,
  useCreateStaffAssignment,
  useDeleteStaffAssignment,
} from '@/hooks/useWardQueries';
import { toast } from 'sonner';

/**
 * StaffWardAssignments - Shows which wards a staff member is assigned to
 *
 * Features:
 * - List all ward assignments for a practitioner
 * - Add new ward assignment
 * - Remove existing assignment
 * - Navigate to ward detail
 */
export function StaffWardAssignments({ practitionerId, practitionerName }) {
  const navigate = useNavigate();
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);

  const { data: assignments = [], isLoading } = usePractitionerAssignments(practitionerId);
  const createMutation = useCreateStaffAssignment();
  const deleteMutation = useDeleteStaffAssignment();

  // Handle create
  const handleCreate = (data) => {
    createMutation.mutate(data, {
      onSuccess: () => {
        toast.success('Ward assignment added');
        setAssignDialogOpen(false);
      },
      onError: (error) => {
        toast.error(error.message || 'Failed to add ward assignment');
      },
    });
  };

  // Handle delete
  const handleDelete = (assignmentId, wardName) => {
    deleteMutation.mutate(assignmentId, {
      onSuccess: () => {
        toast.success(`Removed from ${wardName}`);
      },
      onError: (error) => {
        toast.error(error.message || 'Failed to remove assignment');
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with add button */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {assignments.length === 0
            ? 'Not assigned to any wards'
            : `Assigned to ${assignments.length} ward${assignments.length !== 1 ? 's' : ''}`}
        </p>
        <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Ward
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <AddWardAssignmentForm
              practitionerId={practitionerId}
              existingAssignments={assignments}
              onSubmit={handleCreate}
              isSubmitting={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Assignments list */}
      {assignments.length > 0 && (
        <div className="space-y-2">
          {assignments.map((assignment) => (
            <div
              key={assignment.id}
              className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors group"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Building2 className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigate(`/wards/${assignment.ward}`)}
                      className="font-medium text-sm text-foreground hover:text-primary transition-colors truncate"
                    >
                      {assignment.ward_name}
                    </button>
                    {assignment.is_primary && (
                      <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {assignment.role_name}
                    </span>
                    {assignment.is_primary && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-amber-700 bg-amber-50 border-amber-200">
                        Primary
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => navigate(`/wards/${assignment.ward}`)}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove Ward Assignment</AlertDialogTitle>
                      <AlertDialogDescription>
                        Remove {practitionerName || 'this staff member'} from {assignment.ward_name}?
                        They will no longer appear in the ward staff list.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDelete(assignment.id, assignment.ward_name)}
                        className="bg-destructive text-destructive-foreground"
                      >
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {assignments.length === 0 && (
        <div className="text-center py-6 border rounded-lg bg-muted/20">
          <Building2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            No ward assignments yet
          </p>
          <Button variant="outline" size="sm" onClick={() => setAssignDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add First Ward
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * AddWardAssignmentForm - Form for adding a ward assignment
 */
function AddWardAssignmentForm({
  practitionerId,
  existingAssignments = [],
  onSubmit,
  isSubmitting
}) {
  const [formData, setFormData] = useState({
    practitioner: practitionerId,
    ward: '',
    role: '',
    is_active: true,
    is_primary: false,
  });

  // Fetch wards and roles
  const { data: wardsData = [] } = useWards();
  const { data: rolesData = [] } = useStaffRoles();

  // Handle paginated vs non-paginated response
  const wards = wardsData?.results || wardsData || [];
  const roles = rolesData?.results || rolesData || [];

  // Filter out already assigned wards
  const assignedWardIds = existingAssignments.map(a => a.ward);
  const availableWards = wards.filter(w => !assignedWardIds.includes(w.id));

  const handleChange = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  // Group roles by category
  const nursingRoles = roles.filter(r => r.category === 'nursing');
  const medicalRoles = roles.filter(r => r.category === 'medical');
  const alliedRoles = roles.filter(r => r.category === 'allied');

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Add Ward Assignment</DialogTitle>
        <DialogDescription>
          Assign this staff member to a ward with a specific role
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-4">
        {/* Ward - Searchable Combobox */}
        <div className="space-y-2">
          <Label htmlFor="ward">Ward *</Label>
          <Combobox
            options={availableWards.map(w => ({
              value: w.id,
              label: w.name,
            }))}
            value={formData.ward}
            onChange={(value) => handleChange('ward', value)}
            placeholder="Search wards..."
            searchPlaceholder="Type to search..."
            emptyMessage={availableWards.length === 0
              ? "Already assigned to all wards"
              : "No wards found"}
          />
        </div>

        {/* Role */}
        <div className="space-y-2">
          <Label htmlFor="role">Role *</Label>
          <Select
            value={formData.role}
            onValueChange={(value) => handleChange('role', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              {nursingRoles.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    Nursing
                  </div>
                  {nursingRoles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </>
              )}
              {medicalRoles.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    Medical
                  </div>
                  {medicalRoles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </>
              )}
              {alliedRoles.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    Allied Health
                  </div>
                  {alliedRoles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Primary Ward */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="is_primary"
            checked={formData.is_primary}
            onCheckedChange={(checked) => handleChange('is_primary', checked)}
          />
          <Label htmlFor="is_primary" className="cursor-pointer">
            Set as primary ward
          </Label>
        </div>
      </div>

      <DialogFooter>
        <Button
          type="submit"
          disabled={isSubmitting || !formData.ward || !formData.role}
        >
          {isSubmitting ? 'Adding...' : 'Add Assignment'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export default StaffWardAssignments;
