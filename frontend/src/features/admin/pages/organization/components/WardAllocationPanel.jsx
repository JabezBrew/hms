import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import BedDouble from 'lucide-react/dist/esm/icons/bed-double.js';
import Percent from 'lucide-react/dist/esm/icons/percent.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import {
  useUnitWards,
  useCreateWardAllocation,
  useDeleteWardAllocation,
} from '@/features/admin/hooks';
import { useWardSearch } from '@/features/wards/hooks/useWardQueries';

import { toast } from 'sonner';
import { normalizeApiResults } from '@/lib/utils';

const INITIAL_ALLOCATION = {
  ward: '',
  allocation_percentage: '100',
  allocated_beds: '',
  is_exclusive: true,
  priority: '1',
};

function formatWardType(wardType) {
  return wardType?.replace('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getWardOptionLabel(ward) {
  return `${ward.name}${ward.department_name ? ` - ${ward.department_name}` : ''}${ward.ward_type ? ` - ${ward.ward_type}` : ''}`;
}

function LoadingWardAllocations() {
  return (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

function EmptyWardState({ title, description }) {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <BedDouble className="size-8 mx-auto mb-2 opacity-50" />
      <p>{title}</p>
      {description && <p className="text-xs mt-1">{description}</p>}
    </div>
  );
}

function FacilityWardCard({ ward }) {
  return (
    <div className="p-4 bg-muted/50 rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-md bg-emerald-100 flex items-center justify-center">
            <BedDouble className="size-5 text-emerald-700" />
          </div>
          <div>
            <div className="font-medium">{ward.name}</div>
            <div className="text-sm text-muted-foreground">
              {formatWardType(ward.ward_type)}
            </div>
          </div>
        </div>
        <Badge variant={ward.is_active ? 'default' : 'secondary'}>
          {ward.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-4 pt-3 border-t border-border/50">
        <div>
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <BedDouble className="size-3" />
            Total Beds
          </div>
          <div className="text-sm font-mono">{ward.total_beds}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <BedDouble className="size-3" />
            Available
          </div>
          <div className="text-sm font-mono">{ward.available_beds_count}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <Percent className="size-3" />
            Occupancy
          </div>
          <div className="flex items-center gap-2">
            <Progress value={ward.occupancy_rate} className="h-2 flex-1" />
            <span className="text-sm font-mono">{Math.round(ward.occupancy_rate)}%</span>
          </div>
        </div>
      </div>

      {ward.head_nurse_name && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <Users className="size-3" />
            Head Nurse
          </div>
          <div className="text-sm">{ward.head_nurse_name}</div>
        </div>
      )}
    </div>
  );
}

function FacilityWardsView({ wards }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Facility Wards</h3>
        <Badge variant="secondary" className="font-mono text-xs">
          {wards.length} ward{wards.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      {wards.length === 0 ? (
        <EmptyWardState
          title="No wards in this facility"
          description="Wards are created via the Wards module"
        />
      ) : (
        <div className="space-y-3">
          {wards.map((ward) => (
            <FacilityWardCard key={ward.id} ward={ward} />
          ))}
        </div>
      )}
    </div>
  );
}

function AllocationCard({ allocation, onDelete }) {
  return (
    <div className="p-4 bg-muted/50 rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-md bg-emerald-100 flex items-center justify-center">
            <BedDouble className="size-5 text-emerald-700" />
          </div>
          <div>
            <div className="font-medium">{allocation.ward_name}</div>
            <div className="text-sm text-muted-foreground font-mono">
              {allocation.allocation_type}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {allocation.allocation_type === 'dedicated' && (
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                Dedicated
              </Badge>
            )}
            <Badge variant="outline">Priority {allocation.priority}</Badge>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            aria-label={`Remove ward allocation for ${allocation.ward_name}`}
            onClick={() => onDelete(allocation.id)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 pt-3 border-t border-border/50">
        {allocation.allocated_beds != null && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Allocated Beds</div>
            <div className="text-sm font-mono">{allocation.allocated_beds}</div>
          </div>
        )}
        {allocation.min_beds != null && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Min Beds</div>
            <div className="text-sm font-mono">{allocation.min_beds}</div>
          </div>
        )}
        {allocation.max_beds != null && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Max Beds</div>
            <div className="text-sm font-mono">{allocation.max_beds}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function WardAllocationsList({ wards, onDelete }) {
  if (wards.length === 0) {
    return <EmptyWardState title="No ward allocations" />;
  }

  return (
    <div className="space-y-3">
      {wards.map((allocation) => (
        <AllocationCard
          key={allocation.id}
          allocation={allocation}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function AddWardAllocationDialog({
  open,
  onOpenChange,
  allocation,
  setAllocation,
  selectedWard,
  setSelectedWard,
  wardOptions,
  wardResults,
  searchTerm,
  setSearchTerm,
  isSearching,
  isSaving,
  onSubmit,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Ward Allocation</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Ward</Label>
            <Combobox
              options={wardOptions}
              value={allocation.ward}
              onChange={(value) => {
                setAllocation({ ...allocation, ward: value || '' });
                const selected = wardResults.find((ward) => ward.id === value);
                setSelectedWard(selected || null);
                setSearchTerm('');
              }}
              onInputChange={setSearchTerm}
              placeholder={
                selectedWard
                  ? `${selectedWard.name}${selectedWard.department_name ? ` - ${selectedWard.department_name}` : ''}`
                  : 'Search ward by name...'
              }
              searchPlaceholder="Search ward by name..."
              emptyMessage={
                searchTerm.length < 2
                  ? 'Type at least 2 characters to search'
                  : isSearching
                    ? 'Searching...'
                    : 'No wards found'
              }
              isLoading={isSearching}
            />
            <p className="text-xs text-muted-foreground">Search by ward name</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Allocation Percentage</Label>
              <Input
                type="number"
                min="1"
                max="100"
                value={allocation.allocation_percentage}
                onChange={(e) => setAllocation({ ...allocation, allocation_percentage: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Allocated Beds (Optional)</Label>
              <Input
                type="number"
                min="1"
                placeholder="Fixed number"
                value={allocation.allocated_beds}
                onChange={(e) => setAllocation({ ...allocation, allocated_beds: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Priority</Label>
            <Input
              type="number"
              min="1"
              value={allocation.priority}
              onChange={(e) => setAllocation({ ...allocation, priority: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Lower numbers = higher priority for bed assignment
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="is_exclusive"
              checked={allocation.is_exclusive}
              onCheckedChange={(checked) => setAllocation({ ...allocation, is_exclusive: checked })}
            />
            <Label htmlFor="is_exclusive" className="cursor-pointer">
              Exclusive allocation (this unit has priority for these beds)
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!allocation.ward || isSaving}
          >
            Add Allocation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * WardAllocationPanel - Displays wards for a clinical unit
 *
 * For facility-level units: Shows all wards belonging to the facility (read-only view)
 * For other units: Shows ward allocations with add/remove functionality
 */
export function WardAllocationPanel({ unitId, unitType }) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newAllocation, setNewAllocation] = useState(INITIAL_ALLOCATION);
  const [selectedWard, setSelectedWard] = useState(null);

  const { data: wardsData, isLoading } = useUnitWards(unitId);
  const createAllocation = useCreateWardAllocation();
  const deleteAllocation = useDeleteWardAllocation();
  const {
    data: wardSearchResults = [],
    isLoading: isSearching,
    searchTerm,
    setSearchTerm,
  } = useWardSearch({}, { minLength: 2 });

  const wards = wardsData?.data || wardsData || [];
  const wardResults = normalizeApiResults(wardSearchResults);
  const wardOptions = wardResults.map((ward) => ({
    value: ward.id,
    label: getWardOptionLabel(ward),
  }));

  // Check if this is a facility-level unit
  const isFacility = unitType === 'facility';

  const handleAdd = async () => {
    try {
      await createAllocation.mutateAsync({
        unit: unitId,
        ward: newAllocation.ward,
        allocation_percentage: parseFloat(newAllocation.allocation_percentage) || 100,
        allocated_beds: newAllocation.allocated_beds ? parseInt(newAllocation.allocated_beds) : null,
        is_exclusive: newAllocation.is_exclusive,
        priority: parseInt(newAllocation.priority) || 1,
      });
      toast.success('Ward allocation added');
      setShowAddDialog(false);
      setNewAllocation(INITIAL_ALLOCATION);
      setSelectedWard(null);
      setSearchTerm('');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to add ward allocation');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteAllocation.mutateAsync(id);
      toast.success('Ward allocation removed');
    } catch {
      toast.error('Failed to remove ward allocation');
    }
  };

  if (isLoading) {
    return <LoadingWardAllocations />;
  }

  if (isFacility) {
    return <FacilityWardsView wards={wards} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Ward Allocations</h3>
        <Button size="sm" onClick={() => setShowAddDialog(true)}>
          <Plus className="size-4 mr-2" />
          Add Ward
        </Button>
      </div>

      <WardAllocationsList wards={wards} onDelete={handleDelete} />

      <AddWardAllocationDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        allocation={newAllocation}
        setAllocation={setNewAllocation}
        selectedWard={selectedWard}
        setSelectedWard={setSelectedWard}
        wardOptions={wardOptions}
        wardResults={wardResults}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        isSearching={isSearching}
        isSaving={createAllocation.isPending}
        onSubmit={handleAdd}
      />
    </div>
  );
}
