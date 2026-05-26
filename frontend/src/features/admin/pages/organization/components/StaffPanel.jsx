import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Star from 'lucide-react/dist/esm/icons/star.js';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { VirtualList } from '@/components/ui/virtual-list';
import {
  useUnitStaff,
  useUnitStaffCounts,
  useAssignmentTypes,
  useCreateStaffAssignment,
  useDeleteStaffAssignment,
  useUpdateStaffAssignment,
} from '@/features/admin/hooks';
import { useSearchStaff } from '@/features/staff/hooks';
import { useDebounce } from '@/hooks/use-debounce';

import format from 'date-fns/format';
import { toast } from 'sonner';
import { cn, normalizeApiResults, getHashColor } from '@/lib/utils';

/**
 * SortableHeader - Clickable column header for sorting
 */
function SortableHeader({ label, field, sortField, sortDirection, onSort, className }) {
  const isActive = sortField === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn(
        "flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors",
        isActive && "text-foreground",
        className
      )}
    >
      {label}
	      <span className="flex flex-col">
	        <ChevronUp className={cn("size-2.5", isActive && sortDirection === 'asc' ? "text-amber-500" : "text-muted-foreground/40")} />
	        <ChevronDown className={cn("-mt-1 size-2.5", isActive && sortDirection === 'desc' ? "text-amber-500" : "text-muted-foreground/40")} />
	      </span>
    </button>
  );
}

/**
 * StaffPanel - Manages staff assignments for a clinical unit
 * Uses Chronicle Design System styling with sortable table
 */
export function StaffPanel({ unitId }) {
  const AUTO_FETCH_LIMIT = 3;
  const navigate = useNavigate();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [listSearch, setListSearch] = useState('');
  const [autoFetchAttempts, setAutoFetchAttempts] = useState(0);
  const [sortField, setSortField] = useState('practitioner_name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [newAssignment, setNewAssignment] = useState({
    assignment_type: '',
    practitioner: '',
    is_primary: false,
    effective_from: format(new Date(), 'yyyy-MM-dd'),
    effective_until: '',
  });
  const [selectedPractitioner, setSelectedPractitioner] = useState(null);

  const debouncedSearch = useDebounce(listSearch, 300);
  const activeQuery = debouncedSearch.length >= 2 ? debouncedSearch : '';

  const {
    data: staffData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    loadedCount,
    isDerived,
  } = useUnitStaff(unitId, {
    include_descendants: true,
    q: activeQuery,
    page_size: 100,
  });
  const { totalCount } = useUnitStaffCounts(unitId, {
    include_descendants: true,
    q: activeQuery,
  });
  const { data: assignmentTypesData } = useAssignmentTypes();
  const createAssignment = useCreateStaffAssignment();
  const updateAssignment = useUpdateStaffAssignment();
  const deleteAssignment = useDeleteStaffAssignment();
  const {
    data: staffSearchResults = [],
    isLoading: isSearching,
    searchTerm,
    setSearchTerm,
  } = useSearchStaff({ staffKind: 'clinical' }, { minLength: 2 });

  const staff = useMemo(() => {
    const pages = staffData?.pages || [];
    return pages.flatMap((page) => page.results || []);
  }, [staffData]);

  // Sort staff based on current sort field and direction
  const sortedStaff = useMemo(() => {
    if (!staff.length) return staff;

    return staff.toSorted((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      // Handle null/undefined
      if (aVal == null) aVal = '';
      if (bVal == null) bVal = '';

      // String comparison
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      // Date comparison
      if (sortField === 'effective_from') {
        aVal = aVal ? new Date(aVal).getTime() : 0;
        bVal = bVal ? new Date(bVal).getTime() : 0;
      }

      // Number comparison for FTE
      if (sortField === 'fte_percentage') {
        aVal = Number(aVal) || 0;
        bVal = Number(bVal) || 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [staff, sortField, sortDirection]);

  const safeLoadedCount = loadedCount ?? staff.length;
  const resolvedTotalCount = totalCount ?? safeLoadedCount;
  const countLabel = totalCount == null
    ? `${safeLoadedCount} loaded`
    : `${resolvedTotalCount} total`;
  const assignmentTypes = Array.isArray(assignmentTypesData) ? assignmentTypesData : [];
  const staffResults = normalizeApiResults(staffSearchResults);
  const practitionerOptions = staffResults
    .filter((member) => member.practitioner_id)
    .map((member) => ({
      value: member.practitioner_id,
      label: `${member.name || 'Unknown'}${member.employee_id ? ` - ${member.employee_id}` : ''}`,
    }));

  const handleSort = useCallback((field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }, [sortField]);

  const handleSelectAll = useCallback(() => {
    if (selectedRows.size === sortedStaff.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(sortedStaff.map(m => m.id)));
    }
  }, [sortedStaff, selectedRows.size]);

  const handleSelectRow = useCallback((id, event) => {
    event.stopPropagation();
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleOpenStaff = (staffId) => {
    if (!staffId) {
      return;
    }
    navigate(`/staff/${staffId}`);
  };

  const handleEdit = (member, event) => {
    event.stopPropagation();
    setEditingAssignment({
      id: member.id,
      assignment_type: member.assignment_type?.toString() || '',
      is_primary: member.is_primary,
      effective_from: member.effective_from || '',
      effective_until: member.effective_until || '',
      practitioner_name: member.practitioner_name,
      employee_id: member.employee_id,
    });
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!editingAssignment) return;
    try {
      await updateAssignment.mutateAsync({
        id: editingAssignment.id,
        data: {
          assignment_type: editingAssignment.assignment_type,
          is_primary: editingAssignment.is_primary,
          effective_from: editingAssignment.effective_from,
          effective_until: editingAssignment.effective_until || null,
        },
      });
      toast.success('Assignment updated');
      setShowEditDialog(false);
      setEditingAssignment(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update assignment');
    }
  };

  const handleAdd = async () => {
    try {
      await createAssignment.mutateAsync({
        unit: unitId,
        assignment_type: newAssignment.assignment_type,
        practitioner: newAssignment.practitioner,
        is_primary: newAssignment.is_primary,
        effective_from: newAssignment.effective_from,
        effective_until: newAssignment.effective_until || null,
      });
      toast.success('Staff assignment added');
      setShowAddDialog(false);
      setNewAssignment({
        assignment_type: '',
        practitioner: '',
        is_primary: false,
        effective_from: format(new Date(), 'yyyy-MM-dd'),
        effective_until: '',
      });
      setSelectedPractitioner(null);
      setSearchTerm('');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to add staff assignment');
    }
  };

  const handleDelete = async (id, event) => {
    if (event) event.stopPropagation();
    try {
      await deleteAssignment.mutateAsync(id);
      toast.success('Staff assignment removed');
      setSelectedRows(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch {
      toast.error('Failed to remove staff assignment');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedRows.size === 0) return;
    const ids = Array.from(selectedRows);
    try {
      await Promise.all(ids.map(id => deleteAssignment.mutateAsync(id)));
      toast.success(`Removed ${ids.length} assignment${ids.length > 1 ? 's' : ''}`);
      setSelectedRows(new Set());
    } catch {
      toast.error('Failed to remove some assignments');
    }
  };

  const isSearchActive = activeQuery.length > 0;
  const isDerivedEmpty = isDerived && staff.length === 0 && (totalCount == null || totalCount > 0);
  const shouldAutoFetch = isDerivedEmpty && hasNextPage && autoFetchAttempts < AUTO_FETCH_LIMIT;
  const showLoadMore = isDerivedEmpty && hasNextPage && autoFetchAttempts >= AUTO_FETCH_LIMIT;
  const isSearchingParent = isDerivedEmpty && hasNextPage && autoFetchAttempts < AUTO_FETCH_LIMIT;
  const emptyTitle = isSearchingParent
    ? 'Searching assignments'
    : isSearchActive
      ? 'No matching staff'
      : 'No staff assignments';
  const emptyDetail = isSearchingParent
    ? 'Loading more results from the parent unit'
    : isSearchActive
      ? 'Try a different name or employee ID'
      : 'Assign staff members to this unit';

  useEffect(() => {
    setAutoFetchAttempts(0);
  }, [unitId, activeQuery, isDerived]);

  useEffect(() => {
    if (!shouldAutoFetch || isLoading || isFetchingNextPage) {
      return;
    }
    setAutoFetchAttempts((prev) => prev + 1);
    fetchNextPage();
  }, [shouldAutoFetch, isLoading, isFetchingNextPage, fetchNextPage]);

  // Clear selection when data changes
  useEffect(() => {
    setSelectedRows(new Set());
  }, [unitId, activeQuery]);

  const showSkeleton = isLoading && staff.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Clinical Staff
          </h3>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {countLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {selectedRows.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkDelete}
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20 font-mono text-xs"
            >
              <Trash2 className="size-4 mr-1.5" />
              Remove ({selectedRows.size})
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => setShowAddDialog(true)}
            className="bg-sky-600 hover:bg-sky-700 text-white font-mono text-xs"
          >
            <Plus className="size-4 mr-1.5" />
            Add Staff
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Input
          value={listSearch}
          onChange={(event) => setListSearch(event.target.value)}
          placeholder="Search by name or employee ID"
          className="max-w-sm font-mono text-xs"
        />
        {isSearchActive && (
          <span className="text-xs text-muted-foreground">
            {totalCount == null
              ? `Showing ${staff.length}`
              : `Showing ${staff.length} of ${resolvedTotalCount}`}
          </span>
        )}
      </div>

      {showSkeleton ? (
        <div className="rounded-lg border overflow-hidden">
          <div className="h-10 bg-muted/30 border-b" />
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : staff.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/50 mb-3">
            <Users className="size-7 text-muted-foreground/50" />
          </div>
          <p className="text-sm text-muted-foreground">{emptyTitle}</p>
          <p className="text-xs text-muted-foreground/60 mt-1">{emptyDetail}</p>
          {showLoadMore && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4 font-mono text-xs"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              Load more from parent
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-[32px_minmax(140px,1fr)_100px_80px_minmax(120px,1fr)_60px_90px_72px] gap-2 px-3 py-2 bg-muted/30 border-b">
            <div className="flex items-center justify-center">
              <Checkbox
                checked={selectedRows.size === sortedStaff.length && sortedStaff.length > 0}
                onCheckedChange={handleSelectAll}
                aria-label="Select all"
              />
            </div>
            <SortableHeader label="Name" field="practitioner_name" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
            <SortableHeader label="Employee ID" field="employee_id" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
            <SortableHeader label="Unit" field="unit_name" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
            <SortableHeader label="Type" field="assignment_type_name" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
            <SortableHeader label="FTE" field="fte_percentage" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} className="justify-center" />
            <SortableHeader label="Effective" field="effective_from" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground text-center">Actions</div>
          </div>
          {/* Virtual Table Body */}
          <VirtualList
            items={sortedStaff}
            itemHeight={44}
            className="h-[50vh]"
            onEndReached={() => {
              if (hasNextPage && !isFetchingNextPage) {
                fetchNextPage();
              }
            }}
            renderItem={(member) => (
              <div
                key={member.id}
                role="button"
                tabIndex={0}
                className={cn(
                  "group grid grid-cols-[32px_minmax(140px,1fr)_100px_80px_minmax(120px,1fr)_60px_90px_72px] gap-2 items-center px-3 py-2 border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70",
                  selectedRows.has(member.id) && "bg-amber-50/50 dark:bg-amber-900/10"
                )}
                onClick={() => handleOpenStaff(member.staff_id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleOpenStaff(member.staff_id);
                  }
                }}
              >
                <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedRows.has(member.id)}
                    onCheckedChange={(checked) => handleSelectRow(member.id, { stopPropagation: () => {} })}
                    onClick={(e) => handleSelectRow(member.id, e)}
                    aria-label={`Select ${member.practitioner_name}`}
                  />
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-sm truncate">{member.practitioner_name}</span>
                  {member.is_primary && (
                    <Star className="size-3.5 text-amber-500 fill-amber-500 shrink-0" />
                  )}
                </div>
                <div className="truncate">
                  <span className="font-mono text-xs text-muted-foreground">
                    {member.employee_id || '—'}
                  </span>
                </div>
                <div className="truncate">
                  {member.unit_name && (
                    <span className={`inline-flex font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded truncate ${getHashColor(member.unit_name)}`}>
                      {member.unit_name}
                    </span>
                  )}
                </div>
                <div className="truncate">
                  <span className={`inline-flex font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded truncate ${getHashColor(member.assignment_type_name)}`}>
                    {member.assignment_type_name}
                  </span>
                </div>
                <div className="text-center">
                  <span className="font-mono text-xs text-muted-foreground">
                    {member.fte_percentage}%
                  </span>
                </div>
                <div>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {member.effective_from && format(new Date(member.effective_from), 'MMM d, yyyy')}
                  </span>
                </div>
                <div className="flex items-center justify-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                    onClick={(event) => handleEdit(member, event)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-0 group-hover:opacity-100 transition-opacity text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                    onClick={(event) => handleDelete(member.id, event)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            )}
          />
          {isFetchingNextPage && (
            <div className="text-xs text-muted-foreground text-center py-2 border-t">Loading more…</div>
          )}
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex size-10 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-900/30">
                <Users className="size-5 text-sky-600 dark:text-sky-400" />
              </div>
              <DialogTitle className="font-display text-xl">Add Staff Assignment</DialogTitle>
            </div>
          </DialogHeader>
          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Assignment Type</Label>
              <Select
                value={newAssignment.assignment_type}
                onValueChange={(value) => setNewAssignment({ ...newAssignment, assignment_type: value })}
              >
                <SelectTrigger className="font-mono text-sm">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {assignmentTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id.toString()}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Practitioner</Label>
              <Combobox
                options={practitionerOptions}
                value={newAssignment.practitioner}
                onChange={(value) => {
                  setNewAssignment({ ...newAssignment, practitioner: value || '' });
                  const selected = staffResults.find((member) => member.practitioner_id === value);
                  setSelectedPractitioner(selected || null);
                  setSearchTerm('');
                }}
                onInputChange={setSearchTerm}
                placeholder={
                  selectedPractitioner
                    ? `${selectedPractitioner.name || 'Unknown'}${selectedPractitioner.employee_id ? ` - ${selectedPractitioner.employee_id}` : ''}`
                    : 'Search by name or employee ID...'
                }
                searchPlaceholder="Search by name or employee ID..."
                emptyMessage={
                  searchTerm.length < 2
                    ? 'Type at least 2 characters to search'
                    : isSearching
                      ? 'Searching...'
                      : 'No staff found'
                }
                isLoading={isSearching}
                className="font-mono text-sm"
              />
              <p className="text-[10px] text-muted-foreground">Search by name or employee ID</p>
            </div>

            <div className="flex items-center gap-3 gap-y-0 rounded-lg border p-3">
              <Checkbox
                id="is_primary"
                checked={newAssignment.is_primary}
                onCheckedChange={(checked) => setNewAssignment({ ...newAssignment, is_primary: checked })}
              />
              <div className="space-y-0.5">
                <Label htmlFor="is_primary" className="text-sm font-medium cursor-pointer">
                  Primary assignment
                </Label>
                <p className="text-[10px] text-muted-foreground">This is the staff member's primary unit</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Effective From</Label>
                <Input
                  type="date"
                  value={newAssignment.effective_from}
                  onChange={(e) => setNewAssignment({ ...newAssignment, effective_from: e.target.value })}
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Effective Until</Label>
                <Input
                  type="date"
                  value={newAssignment.effective_until}
                  onChange={(e) => setNewAssignment({ ...newAssignment, effective_until: e.target.value })}
                  className="font-mono"
                />
                <p className="text-[10px] text-muted-foreground">Optional</p>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowAddDialog(false)} className="font-mono text-xs">
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={!newAssignment.assignment_type || !newAssignment.practitioner || createAssignment.isPending}
              className="bg-sky-600 hover:bg-sky-700 text-white font-mono text-xs"
            >
              Add Assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex size-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
                <Pencil className="size-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <DialogTitle className="font-display text-xl">Edit Assignment</DialogTitle>
                {editingAssignment && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {editingAssignment.practitioner_name}
                    {editingAssignment.employee_id && ` • ${editingAssignment.employee_id}`}
                  </p>
                )}
              </div>
            </div>
          </DialogHeader>
          {editingAssignment && (
            <div className="space-y-5 py-4">
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Assignment Type</Label>
                <Select
                  value={editingAssignment.assignment_type}
                  onValueChange={(value) => setEditingAssignment({ ...editingAssignment, assignment_type: value })}
                >
                  <SelectTrigger className="font-mono text-sm">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent className="z-[200]">
                    {assignmentTypes.map((type) => (
                      <SelectItem key={type.id} value={type.id.toString()}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-3 gap-y-0 rounded-lg border p-3">
                <Checkbox
                  id="edit_is_primary"
                  checked={editingAssignment.is_primary}
                  onCheckedChange={(checked) => setEditingAssignment({ ...editingAssignment, is_primary: checked })}
                />
                <div className="space-y-0.5">
                  <Label htmlFor="edit_is_primary" className="text-sm font-medium cursor-pointer">
                    Primary assignment
                  </Label>
                  <p className="text-[10px] text-muted-foreground">This is the staff member's primary unit</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="font-mono text-xs uppercase tracking-wider">Effective From</Label>
                  <Input
                    type="date"
                    value={editingAssignment.effective_from}
                    onChange={(e) => setEditingAssignment({ ...editingAssignment, effective_from: e.target.value })}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="font-mono text-xs uppercase tracking-wider">Effective Until</Label>
                  <Input
                    type="date"
                    value={editingAssignment.effective_until}
                    onChange={(e) => setEditingAssignment({ ...editingAssignment, effective_until: e.target.value })}
                    className="font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground">Optional</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowEditDialog(false)} className="font-mono text-xs">
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={!editingAssignment?.assignment_type || updateAssignment.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white font-mono text-xs"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
