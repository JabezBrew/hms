import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import Star from 'lucide-react/dist/esm/icons/star.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import HeartPulse from 'lucide-react/dist/esm/icons/heart-pulse.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import { useState } from 'react';
import { cn, normalizeApiResults } from '@/lib/utils';
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

const DEFAULT_EMPTY_ARRAY = [];

import {
  useStaffAssignments,
  useStaffRoles,
  useCreateStaffAssignment,
  useUpdateStaffAssignment,
  useDeleteStaffAssignment,
} from '@/features/wards/hooks/useWardQueries';
import { useSearchPractitioners } from '@/features/staff/hooks';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { toast } from 'sonner';

/**
 * WardStaffManagement - Admin interface for managing ward staff assignments
 *
 * Features:
 * - List all staff assigned to a ward
 * - Assign new staff members
 * - Edit existing assignments (role, primary ward)
 * - Remove staff from ward
 */
export function WardStaffManagement({ wardId }) {
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const staffAssignmentMutationsAvailable = !isRustV2ApiMode();

  // Fetch assignments for this ward
  const { data: assignmentsData = [], isLoading } = useStaffAssignments(
    { ward: wardId },
    { enabled: !!wardId }
  );

  // Handle paginated vs non-paginated response
  const assignments = assignmentsData?.results || assignmentsData || [];

  const createMutation = useCreateStaffAssignment();
  const updateMutation = useUpdateStaffAssignment();
  const deleteMutation = useDeleteStaffAssignment();

  // Handle create
  const handleCreate = (data) => {
    createMutation.mutate(data, {
      onSuccess: () => {
        toast.success('Staff member assigned successfully');
        setAssignDialogOpen(false);
      },
      onError: (error) => {
        toast.error(error.message || 'Failed to assign staff member');
      },
    });
  };

  // Handle update
  const handleUpdate = (assignmentId, data) => {
    updateMutation.mutate({ id: assignmentId, data }, {
      onSuccess: () => {
        toast.success('Assignment updated successfully');
        setEditDialogOpen(false);
        setSelectedAssignment(null);
      },
      onError: (error) => {
        toast.error(error.message || 'Failed to update assignment');
      },
    });
  };

  // Handle delete
  const handleDelete = (assignmentId) => {
    deleteMutation.mutate(assignmentId, {
      onSuccess: () => {
        toast.success('Staff member removed from ward');
      },
      onError: (error) => {
        toast.error(error.message || 'Failed to remove staff member');
      },
    });
  };

  // Open edit dialog
  const openEditDialog = (assignment) => {
    setSelectedAssignment(assignment);
    setEditDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Group assignments by category for display
  const nursingStaff = assignments.filter(a => a.role_category === 'nursing');
  const medicalStaff = assignments.filter(a => a.role_category === 'medical');
  const alliedStaff = assignments.filter(a => a.role_category === 'allied');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Ward Staff</h3>
          <p className="text-sm text-muted-foreground">
            Manage nursing, medical, and allied health staff assigned to this ward
          </p>
        </div>
        {staffAssignmentMutationsAvailable && (
          <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="size-4 mr-2" />
                Assign Staff
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <StaffAssignmentForm
                wardId={wardId}
                existingAssignments={assignments}
                onSubmit={handleCreate}
                isSubmitting={createMutation.isPending}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {!staffAssignmentMutationsAvailable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Ward staff assignment management is not available in Rust V2 mode yet. Existing staff
          assignments are shown read-only until generated /api/v2 assignment contracts exist.
        </div>
      )}

      {/* Staff List */}
      {assignments.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <Users className="size-12 text-muted-foreground mx-auto mb-4" />
          <h4 className="text-lg font-medium text-foreground mb-2">No staff assigned</h4>
          <p className="text-sm text-muted-foreground mb-4">
            {staffAssignmentMutationsAvailable
              ? 'Assign nurses, doctors, and allied health staff to this ward'
              : 'Staff assignment data is not available from Rust V2 yet'}
          </p>
          {staffAssignmentMutationsAvailable && (
            <Button onClick={() => setAssignDialogOpen(true)}>
              <UserPlus className="size-4 mr-2" />
              Assign First Staff Member
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Nursing Staff */}
          {nursingStaff.length > 0 && (
            <StaffSection
              title="Nursing Staff"
              icon={<HeartPulse className="size-5 text-rose-500" />}
              assignments={nursingStaff}
              onEdit={openEditDialog}
              onDelete={handleDelete}
              readOnly={!staffAssignmentMutationsAvailable}
            />
          )}

          {/* Medical Staff */}
          {medicalStaff.length > 0 && (
            <StaffSection
              title="Medical Staff"
              icon={<Stethoscope className="size-5 text-sky-500" />}
              assignments={medicalStaff}
              onEdit={openEditDialog}
              onDelete={handleDelete}
              readOnly={!staffAssignmentMutationsAvailable}
            />
          )}

          {/* Allied Health */}
          {alliedStaff.length > 0 && (
            <StaffSection
              title="Allied Health"
              icon={<Users className="size-5 text-emerald-500" />}
              assignments={alliedStaff}
              onEdit={openEditDialog}
              onDelete={handleDelete}
              readOnly={!staffAssignmentMutationsAvailable}
            />
          )}
        </div>
      )}

      {/* Edit Dialog */}
      {staffAssignmentMutationsAvailable && selectedAssignment && (
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-lg">
            <StaffAssignmentForm
              wardId={wardId}
              assignment={selectedAssignment}
              existingAssignments={assignments}
              onSubmit={(data) => handleUpdate(selectedAssignment.id, data)}
              isSubmitting={updateMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * StaffSection - Group of staff by category
 */
function StaffSection({ title, icon, assignments, onEdit, onDelete, readOnly = false }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        <span>{title}</span>
        <Badge variant="secondary" className="ml-auto">
          {assignments.length}
        </Badge>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {assignments.map((assignment) => (
          <StaffCard
            key={assignment.id}
            assignment={assignment}
            onEdit={() => onEdit(assignment)}
            onDelete={() => onDelete(assignment.id)}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * StaffCard - Individual staff assignment card
 */
function StaffCard({ assignment, onEdit, onDelete, readOnly = false }) {
  // Get color for role category
  const getCategoryColor = (category) => {
    switch (category) {
      case 'nursing':
        return 'border-l-rose-400';
      case 'medical':
        return 'border-l-sky-400';
      case 'allied':
        return 'border-l-emerald-400';
      default:
        return 'border-l-stone-400';
    }
  };

  return (
    <div className={cn(
      "rounded-lg p-4 border border-l-4 bg-card space-y-3",
      getCategoryColor(assignment.role_category),
      !assignment.is_active && "opacity-60"
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-sm text-foreground truncate">
              {assignment.practitioner_name}
            </h4>
            {assignment.is_primary && (
              <Star className="size-3.5 text-amber-500 fill-amber-500 shrink-0" />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {assignment.role_name}
          </p>
        </div>
        {!assignment.is_active && (
          <Badge variant="outline" className="text-xs shrink-0">
            Inactive
          </Badge>
        )}
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        {assignment.is_primary && (
          <Badge variant="outline" className="text-xs text-amber-700 bg-amber-50 border-amber-200">
            Primary Ward
          </Badge>
        )}
      </div>

      {/* Actions */}
      {!readOnly && (
        <div className="flex items-center gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={onEdit} className="flex-1">
            <Edit className="size-3.5 mr-1" />
            Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive">
                <Trash2 className="size-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove Staff Assignment</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to remove {assignment.practitioner_name} from this ward?
                  This will not delete the staff member, only their ward assignment.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground">
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}

/**
 * StaffAssignmentForm - Form for assigning/editing staff
 * Uses server-side search for practitioners to scale with large staff counts
 */
function StaffAssignmentForm({
  wardId,
  assignment = null,
  existingAssignments = DEFAULT_EMPTY_ARRAY,
  onSubmit,
  isSubmitting
}) {
  const isEdit = !!assignment;

  const [formData, setFormData] = useState({
    ward: wardId,
    practitioner: assignment?.practitioner || '',
    role: assignment?.role || '',
    is_active: assignment?.is_active ?? true,
    is_primary: assignment?.is_primary ?? false,
  });

  // Track selected practitioner name for display
  const [selectedPractitioner, setSelectedPractitioner] = useState(
    assignment ? { id: assignment.practitioner, name: assignment.practitioner_name } : null
  );

  // Server-side search for practitioners
  const {
    data: searchResults = [],
    isLoading: isSearching,
    searchTerm,
    setSearchTerm,
  } = useSearchPractitioners(false, { minLength: 2 });

  // Handle paginated vs non-paginated response
  const practitioners = normalizeApiResults(searchResults);

  // Fetch roles (small list, OK to preload)
  const { data: rolesData = [] } = useStaffRoles();
  const roles = normalizeApiResults(rolesData);

  // Filter out already assigned practitioners from search results
  const assignedPractitionerIds = existingAssignments.map(a => a.practitioner_id);
  const availablePractitioners = practitioners.filter(p =>
    !assignedPractitionerIds.includes(p.id)
  );

  // Convert to combobox options
  const practitionerOptions = availablePractitioners.map(p => ({
    value: p.id,
    label: p.name || 'Unknown',
  }));

  const handleChange = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handlePractitionerSelect = (practitionerId) => {
    handleChange('practitioner', practitionerId);
    // Find and store the selected practitioner for display
    const selected = practitioners.find(p => p.id === practitionerId);
    if (selected) {
      setSelectedPractitioner(selected);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  // Group roles by category for better UX
  const nursingRoles = roles.filter(r => r.category === 'nursing');
  const medicalRoles = roles.filter(r => r.category === 'medical');
  const alliedRoles = roles.filter(r => r.category === 'allied');

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit Assignment' : 'Assign Staff to Ward'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Update role and assignment settings'
            : 'Search for a staff member by name to assign them to this ward'}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-4">
        {/* Staff Member - Server-side Searchable Combobox */}
        <div className="space-y-2">
          <Label htmlFor="practitioner">Staff Member *</Label>
          {isEdit ? (
            <div className="flex items-center h-10 px-3 rounded-md border bg-muted/50 text-sm">
              {selectedPractitioner?.name || 'Unknown'}
            </div>
          ) : (
            <Combobox
              options={practitionerOptions}
              value={formData.practitioner}
              onChange={handlePractitionerSelect}
              onInputChange={setSearchTerm}
              placeholder={selectedPractitioner?.name || "Type to search staff..."}
              searchPlaceholder="Search by name..."
              emptyMessage={
                searchTerm.length < 2
                  ? "Type at least 2 characters to search"
                  : isSearching
                    ? "Searching..."
                    : availablePractitioners.length === 0 && practitioners.length > 0
                      ? "All matching staff already assigned"
                      : "No staff found"
              }
              isLoading={isSearching}
              disabled={isEdit}
            />
          )}
          {!isEdit && (
            <p className="text-xs text-muted-foreground">
              Search by name to find staff members
            </p>
          )}
          {isEdit && (
            <p className="text-xs text-muted-foreground">
              Staff member cannot be changed. Remove and create new assignment instead.
            </p>
          )}
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
        <div className="flex items-center gap-x-2">
          <Checkbox
            id="is_primary"
            checked={formData.is_primary}
            onCheckedChange={(checked) => handleChange('is_primary', checked)}
          />
          <Label htmlFor="is_primary" className="cursor-pointer">
            Primary ward for this staff member
          </Label>
        </div>

        {/* Active */}
        <div className="flex items-center gap-x-2">
          <Checkbox
            id="is_active"
            checked={formData.is_active}
            onCheckedChange={(checked) => handleChange('is_active', checked)}
          />
          <Label htmlFor="is_active" className="cursor-pointer">
            Active assignment
          </Label>
        </div>
      </div>

      <DialogFooter>
        <Button
          type="submit"
          disabled={isSubmitting || !formData.practitioner || !formData.role}
        >
          {isSubmitting ? 'Saving...' : isEdit ? 'Update Assignment' : 'Assign Staff'}
        </Button>
      </DialogFooter>
    </form>
  );
}
