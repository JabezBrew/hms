import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Star from 'lucide-react/dist/esm/icons/star.js';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
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
  useUnitMembers,
  useUnitMembersCounts,
  useAssignmentTypes,
  useCreateUnitMember,
  useDeleteUnitMember,
  useUpdateUnitMember,
} from '@/features/admin/hooks';
import { useSearchStaff } from '@/features/staff/hooks';
import { useDebounce } from '@/hooks/use-debounce';

import format from 'date-fns/format';
import { toast } from 'sonner';
import { cn, normalizeApiResults, getHashColor } from '@/lib/utils';

const AUTO_FETCH_LIMIT = 3;

function defaultEffectiveFrom() {
  return format(new Date(), 'yyyy-MM-dd');
}

function createAssignmentDraft() {
  return {
    assignment_type: '',
    staff: '',
    staff_label: '',
    is_primary: false,
    effective_from: defaultEffectiveFrom(),
    effective_until: '',
  };
}

function assignmentDraftReducer(state, action) {
  switch (action.type) {
    case 'field':
      return { ...state, [action.field]: action.value };
    case 'staff':
      return {
        ...state,
        staff: action.staffId,
        staff_label: action.staffLabel,
      };
    case 'primary':
      return { ...state, is_primary: action.checked };
    default:
      return state;
  }
}

function editAssignmentDraftFromAssignment(assignment) {
  return {
    id: assignment.id,
    assignment_type: assignment.assignment_type?.toString() || '',
    is_primary: assignment.is_primary,
    effective_from: assignment.effective_from || '',
    effective_until: assignment.effective_until || '',
  };
}

function editAssignmentDraftReducer(state, action) {
  switch (action.type) {
    case 'field':
      return { ...state, [action.field]: action.value };
    case 'primary':
      return { ...state, is_primary: action.checked };
    default:
      return state;
  }
}

function autoFetchReducer(state, action) {
  if (action.type !== 'increment') {
    return state;
  }

  return {
    scope: action.scope,
    attempts: state.scope === action.scope ? state.attempts + 1 : 1,
  };
}

function staffOptionLabel(member) {
  return `${member.name || 'Unknown'}${member.employee_id ? ` - ${member.employee_id}` : ''}`;
}

function editableAssignmentFromMember(member) {
  return {
    id: member.id,
    assignment_type: member.assignment_type?.toString() || '',
    is_primary: member.is_primary,
    effective_from: member.effective_from || '',
    effective_until: member.effective_until || '',
    staff_name: member.staff_name,
    staff_employee_id: member.staff_employee_id,
  };
}

const initialPanelState = {
  showAddDialog: false,
  editingAssignment: null,
  listSearch: '',
  sortField: 'staff_name',
  sortDirection: 'asc',
};

function panelReducer(state, action) {
  switch (action.type) {
    case 'open-add':
      return { ...state, showAddDialog: true };
    case 'close-add':
      return { ...state, showAddDialog: false };
    case 'edit-assignment':
      return { ...state, editingAssignment: action.assignment };
    case 'close-edit':
      return { ...state, editingAssignment: null };
    case 'search':
      return { ...state, listSearch: action.value };
    case 'sort':
      if (state.sortField === action.field) {
        return {
          ...state,
          sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc',
        };
      }
      return {
        ...state,
        sortField: action.field,
        sortDirection: 'asc',
      };
    default:
      return state;
  }
}

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
        <ChevronUp className={cn("size-2.5", isActive && sortDirection === 'asc' ? "text-slate-600" : "text-muted-foreground/40")} />
        <ChevronDown className={cn("-mt-1 size-2.5", isActive && sortDirection === 'desc' ? "text-slate-600" : "text-muted-foreground/40")} />
      </span>
    </button>
  );
}

function OpsStaffToolbar({ countLabel, selectedCount, onBulkDelete, onAddStaff }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Operations Staff
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {countLabel}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {selectedCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={onBulkDelete}
            className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20 font-mono text-xs"
          >
            <Trash2 className="size-4 mr-1.5" />
            Remove ({selectedCount})
          </Button>
        )}
        <Button
          size="sm"
          onClick={onAddStaff}
          className="bg-slate-600 hover:bg-slate-700 text-white font-mono text-xs"
        >
          <Plus className="size-4 mr-1.5" />
          Add Staff
        </Button>
      </div>
    </div>
  );
}

function OpsStaffSearch({ value, onChange, isSearchActive, membersLength, totalCount, resolvedTotalCount }) {
  return (
    <div className="flex items-center gap-3">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search by name or employee ID"
        className="max-w-sm font-mono text-xs"
      />
      {isSearchActive && (
        <span className="text-xs text-muted-foreground">
          {totalCount == null
            ? `Showing ${membersLength}`
            : `Showing ${membersLength} of ${resolvedTotalCount}`}
        </span>
      )}
    </div>
  );
}

function OpsStaffSkeleton() {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="h-10 bg-muted/30 border-b" />
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

function OpsStaffEmptyState({ emptyTitle, emptyDetail, showLoadMore, isFetchingNextPage, onLoadMore }) {
  return (
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
          onClick={onLoadMore}
          disabled={isFetchingNextPage}
        >
          Load more from parent
        </Button>
      )}
    </div>
  );
}

function OpsStaffTable({
  members,
  selectedRows,
  sortField,
  sortDirection,
  onSort,
  onSelectAll,
  onSelectRow,
  onOpenStaff,
  onEdit,
  onDelete,
  hasNextPage,
  isFetchingNextPage,
  onFetchNextPage,
}) {
  const allRowsSelected = selectedRows.size === members.length && members.length > 0;

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="grid grid-cols-[32px_minmax(140px,1fr)_100px_80px_minmax(120px,1fr)_90px_72px] gap-2 px-3 py-2 bg-muted/30 border-b">
        <div className="flex items-center justify-center">
          <Checkbox
            checked={allRowsSelected}
            onCheckedChange={onSelectAll}
            aria-label="Select all"
          />
        </div>
        <SortableHeader label="Name" field="staff_name" sortField={sortField} sortDirection={sortDirection} onSort={onSort} />
        <SortableHeader label="Employee ID" field="staff_employee_id" sortField={sortField} sortDirection={sortDirection} onSort={onSort} />
        <SortableHeader label="Unit" field="unit_name" sortField={sortField} sortDirection={sortDirection} onSort={onSort} />
        <SortableHeader label="Type" field="assignment_type_name" sortField={sortField} sortDirection={sortDirection} onSort={onSort} />
        <SortableHeader label="Effective" field="effective_from" sortField={sortField} sortDirection={sortDirection} onSort={onSort} />
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground text-center">Actions</div>
      </div>
      <VirtualList
        items={members}
        itemHeight={44}
        className="h-[50vh]"
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) {
            onFetchNextPage();
          }
        }}
        renderItem={(member) => (
          <div
            key={member.id}
            className={cn(
              "group grid grid-cols-[32px_minmax(140px,1fr)_100px_80px_minmax(120px,1fr)_90px_72px] gap-2 items-center border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors",
              selectedRows.has(member.id) && "bg-slate-50/50 dark:bg-slate-900/10"
            )}
          >
            <div className="flex items-center justify-center px-3 py-2">
              <Checkbox
                checked={selectedRows.has(member.id)}
                onCheckedChange={() => onSelectRow(member.id)}
                aria-label={`Select ${member.staff_name}`}
              />
            </div>
            <button
              type="button"
              onClick={() => onOpenStaff(member.staff)}
              className="col-span-5 grid grid-cols-[minmax(140px,1fr)_100px_80px_minmax(120px,1fr)_90px] gap-2 items-center px-0 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/70"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-sm truncate">{member.staff_name}</span>
                {member.is_primary && (
                  <Star className="size-3.5 text-amber-500 fill-amber-500 shrink-0" />
                )}
              </span>
              <span className="truncate">
                <span className="font-mono text-xs text-muted-foreground">
                  {member.staff_employee_id || '—'}
                </span>
              </span>
              <span className="truncate">
                {member.unit_name && (
                  <span className={`inline-flex font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded truncate ${getHashColor(member.unit_name)}`}>
                    {member.unit_name}
                  </span>
                )}
              </span>
              <span className="truncate">
                <span className={`inline-flex font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded truncate ${getHashColor(member.assignment_type_name)}`}>
                  {member.assignment_type_name}
                </span>
              </span>
              <span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {member.effective_from && format(new Date(member.effective_from), 'MMM d, yyyy')}
                </span>
              </span>
            </button>
            <div className="flex items-center justify-center gap-1 px-3 py-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${member.staff_name}`}
                className="size-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                onClick={() => onEdit(member)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${member.staff_name}`}
                className="size-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                onClick={() => onDelete(member.id)}
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
  );
}

function OpsStaffAssignments({
  unitId,
  activeQuery,
  listSearch,
  onListSearchChange,
  sortField,
  sortDirection,
  onSort,
  onAddStaff,
  onEditAssignment,
}) {
  const navigate = useNavigate();
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [autoFetchState, dispatchAutoFetch] = useReducer(autoFetchReducer, {
    scope: '',
    attempts: 0,
  });
  const deleteAssignment = useDeleteUnitMember();

  const {
    data: membersData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    loadedCount,
    isDerived,
  } = useUnitMembers(unitId, {
    include_descendants: true,
    q: activeQuery,
    page_size: 100,
  });
  const { totalCount } = useUnitMembersCounts(unitId, {
    include_descendants: true,
    q: activeQuery,
  });

  const members = useMemo(() => {
    const pages = membersData?.pages || [];
    return pages.flatMap((page) => page.results || []);
  }, [membersData]);

  const sortedMembers = useMemo(() => {
    if (!members.length) return members;

    return members.toSorted((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (aVal == null) aVal = '';
      if (bVal == null) bVal = '';

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      if (sortField === 'effective_from') {
        aVal = aVal ? new Date(aVal).getTime() : 0;
        bVal = bVal ? new Date(bVal).getTime() : 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [members, sortField, sortDirection]);

  const safeLoadedCount = loadedCount ?? members.length;
  const resolvedTotalCount = totalCount ?? safeLoadedCount;
  const countLabel = totalCount == null
    ? `${safeLoadedCount} loaded`
    : `${resolvedTotalCount} total`;
  const isSearchActive = activeQuery.length > 0;
  const autoFetchScope = `${unitId}:${activeQuery}:${isDerived ? 'derived' : 'direct'}`;
  const autoFetchAttempts = autoFetchState.scope === autoFetchScope ? autoFetchState.attempts : 0;
  const isDerivedEmpty = isDerived && members.length === 0 && (totalCount == null || totalCount > 0);
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
      : 'Assign operations staff to this unit';
  const showSkeleton = isLoading && members.length === 0;

  useEffect(() => {
    if (!shouldAutoFetch || isLoading || isFetchingNextPage) {
      return;
    }
    dispatchAutoFetch({ type: 'increment', scope: autoFetchScope });
    fetchNextPage();
  }, [shouldAutoFetch, isLoading, isFetchingNextPage, fetchNextPage, autoFetchScope]);

  const handleSelectAll = useCallback(() => {
    if (selectedRows.size === sortedMembers.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(sortedMembers.map((member) => member.id)));
    }
  }, [sortedMembers, selectedRows.size]);

  const handleSelectRow = useCallback((id) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleOpenStaff = useCallback((staffId) => {
    if (!staffId) {
      return;
    }
    navigate(`/staff/${staffId}`);
  }, [navigate]);

  const handleDelete = useCallback(async (id) => {
    try {
      await deleteAssignment.mutateAsync(id);
      toast.success('Staff assignment removed');
      setSelectedRows((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch {
      toast.error('Failed to remove staff assignment');
    }
  }, [deleteAssignment]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedRows.size === 0) return;
    const ids = Array.from(selectedRows);
    try {
      await Promise.all(ids.map((id) => deleteAssignment.mutateAsync(id)));
      toast.success(`Removed ${ids.length} assignment${ids.length > 1 ? 's' : ''}`);
      setSelectedRows(new Set());
    } catch {
      toast.error('Failed to remove some assignments');
    }
  }, [deleteAssignment, selectedRows]);

  return (
    <>
      <OpsStaffToolbar
        countLabel={countLabel}
        selectedCount={selectedRows.size}
        onBulkDelete={handleBulkDelete}
        onAddStaff={onAddStaff}
      />

      <OpsStaffSearch
        value={listSearch}
        onChange={onListSearchChange}
        isSearchActive={isSearchActive}
        membersLength={members.length}
        totalCount={totalCount}
        resolvedTotalCount={resolvedTotalCount}
      />

      {showSkeleton ? (
        <OpsStaffSkeleton />
      ) : members.length === 0 ? (
        <OpsStaffEmptyState
          emptyTitle={emptyTitle}
          emptyDetail={emptyDetail}
          showLoadMore={showLoadMore}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={fetchNextPage}
        />
      ) : (
        <OpsStaffTable
          members={sortedMembers}
          selectedRows={selectedRows}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={onSort}
          onSelectAll={handleSelectAll}
          onSelectRow={handleSelectRow}
          onOpenStaff={handleOpenStaff}
          onEdit={onEditAssignment}
          onDelete={handleDelete}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onFetchNextPage={fetchNextPage}
        />
      )}
    </>
  );
}

function AddAssignmentDialog({
  open,
  onOpenChange,
  assignmentTypes,
  staffOptions,
  staffResults,
  searchTerm,
  setSearchTerm,
  isSearching,
  isPending,
  onSubmit,
}) {
  const [draft, dispatch] = useReducer(assignmentDraftReducer, undefined, createAssignmentDraft);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex size-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900/30">
              <Users className="size-5 text-slate-600 dark:text-slate-400" />
            </div>
            <DialogTitle className="font-display text-xl">Add Operations Staff</DialogTitle>
          </div>
        </DialogHeader>
        <div className="space-y-5 py-4">
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">Assignment Type</Label>
            <Select
              value={draft.assignment_type}
              onValueChange={(value) => dispatch({ type: 'field', field: 'assignment_type', value })}
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
            <Label className="font-mono text-xs uppercase tracking-wider">Staff Member</Label>
            <Combobox
              options={staffOptions}
              value={draft.staff}
              onChange={(value) => {
                const selected = staffResults.find((member) => member.id === value);
                dispatch({
                  type: 'staff',
                  staffId: value || '',
                  staffLabel: selected ? staffOptionLabel(selected) : '',
                });
                setSearchTerm('');
              }}
              onInputChange={setSearchTerm}
              placeholder={draft.staff_label || 'Search by name or employee ID...'}
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
              id="ops_is_primary"
              checked={draft.is_primary}
              onCheckedChange={(checked) => dispatch({ type: 'primary', checked: checked === true })}
            />
            <div className="space-y-0.5">
              <Label htmlFor="ops_is_primary" className="text-sm font-medium cursor-pointer">
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
                value={draft.effective_from}
                onChange={(event) => dispatch({ type: 'field', field: 'effective_from', value: event.target.value })}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Effective Until</Label>
              <Input
                type="date"
                value={draft.effective_until}
                onChange={(event) => dispatch({ type: 'field', field: 'effective_until', value: event.target.value })}
                className="font-mono"
              />
              <p className="text-[10px] text-muted-foreground">Optional</p>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="font-mono text-xs">
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit(draft)}
            disabled={!draft.assignment_type || !draft.staff || isPending}
            className="bg-slate-600 hover:bg-slate-700 text-white font-mono text-xs"
          >
            Add Assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditAssignmentDialog({ assignment, assignmentTypes, isPending, onOpenChange, onSubmit }) {
  const isOpen = Boolean(assignment);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {assignment && (
        <EditAssignmentDialogContent
          key={assignment.id}
          assignment={assignment}
          assignmentTypes={assignmentTypes}
          isPending={isPending}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
        />
      )}
    </Dialog>
  );
}

function EditAssignmentDialogContent({ assignment, assignmentTypes, isPending, onOpenChange, onSubmit }) {
  const [draft, dispatch] = useReducer(
    editAssignmentDraftReducer,
    assignment,
    editAssignmentDraftFromAssignment
  );

  return (
    <DialogContent>
      <DialogHeader>
        <div className="flex items-center gap-3 mb-2">
          <div className="flex size-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900/30">
            <Pencil className="size-5 text-slate-600 dark:text-slate-400" />
          </div>
          <div>
            <DialogTitle className="font-display text-xl">Edit Assignment</DialogTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              {assignment.staff_name}
              {assignment.staff_employee_id && ` • ${assignment.staff_employee_id}`}
            </p>
          </div>
        </div>
      </DialogHeader>
      <div className="space-y-5 py-4">
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider">Assignment Type</Label>
          <Select
            value={draft.assignment_type}
            onValueChange={(value) => dispatch({ type: 'field', field: 'assignment_type', value })}
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
            id="edit_ops_is_primary"
            checked={draft.is_primary}
            onCheckedChange={(checked) => dispatch({ type: 'primary', checked: checked === true })}
          />
          <div className="space-y-0.5">
            <Label htmlFor="edit_ops_is_primary" className="text-sm font-medium cursor-pointer">
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
              value={draft.effective_from}
              onChange={(event) => dispatch({ type: 'field', field: 'effective_from', value: event.target.value })}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">Effective Until</Label>
            <Input
              type="date"
              value={draft.effective_until}
              onChange={(event) => dispatch({ type: 'field', field: 'effective_until', value: event.target.value })}
              className="font-mono"
            />
            <p className="text-[10px] text-muted-foreground">Optional</p>
          </div>
        </div>
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={() => onOpenChange(false)} className="font-mono text-xs">
          Cancel
        </Button>
        <Button
          onClick={() => onSubmit(draft)}
          disabled={!draft.assignment_type || isPending}
          className="bg-slate-600 hover:bg-slate-700 text-white font-mono text-xs"
        >
          Save Changes
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * OpsStaffPanel - Manages non-clinical staff assignments for an ops unit
 * Uses Chronicle Design System styling with sortable table
 */
export function OpsStaffPanel({ unitId }) {
  const [panelState, dispatchPanel] = useReducer(panelReducer, initialPanelState);
  const {
    showAddDialog,
    editingAssignment,
    listSearch,
    sortField,
    sortDirection,
  } = panelState;

  const debouncedSearch = useDebounce(listSearch, 300);
  const activeQuery = debouncedSearch.length >= 2 ? debouncedSearch : '';
  const assignmentListKey = `${unitId}:${activeQuery}`;

  const { data: assignmentTypesData } = useAssignmentTypes();
  const createAssignment = useCreateUnitMember();
  const updateAssignment = useUpdateUnitMember();
  const {
    data: staffSearchResults = [],
    isLoading: isSearching,
    searchTerm,
    setSearchTerm,
  } = useSearchStaff({ staffKind: 'ops' }, { minLength: 2 });

  const assignmentTypes = Array.isArray(assignmentTypesData) ? assignmentTypesData : [];
  const staffResults = normalizeApiResults(staffSearchResults);
  const staffOptions = staffResults.map((member) => ({
    value: member.id,
    label: staffOptionLabel(member),
  }));

  const handleSort = useCallback((field) => {
    dispatchPanel({ type: 'sort', field });
  }, []);

  const handleAddDialogOpenChange = useCallback((open) => {
    dispatchPanel({ type: open ? 'open-add' : 'close-add' });
    if (!open) {
      setSearchTerm('');
    }
  }, [setSearchTerm]);

  const handleEditDialogOpenChange = useCallback((open) => {
    if (!open) {
      dispatchPanel({ type: 'close-edit' });
    }
  }, []);

  const handleCreateAssignment = useCallback(async (draft) => {
    try {
      await createAssignment.mutateAsync({
        unit: unitId,
        assignment_type: draft.assignment_type,
        staff: draft.staff,
        is_primary: draft.is_primary,
        effective_from: draft.effective_from,
        effective_until: draft.effective_until || null,
      });
      toast.success('Staff assignment added');
      dispatchPanel({ type: 'close-add' });
      setSearchTerm('');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to add staff assignment');
    }
  }, [createAssignment, setSearchTerm, unitId]);

  const handleUpdateAssignment = useCallback(async (draft) => {
    try {
      await updateAssignment.mutateAsync({
        id: draft.id,
        data: {
          assignment_type: draft.assignment_type,
          is_primary: draft.is_primary,
          effective_from: draft.effective_from,
          effective_until: draft.effective_until || null,
        },
      });
      toast.success('Assignment updated');
      dispatchPanel({ type: 'close-edit' });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update assignment');
    }
  }, [updateAssignment]);

  const handleEditAssignment = useCallback((member) => {
    dispatchPanel({
      type: 'edit-assignment',
      assignment: editableAssignmentFromMember(member),
    });
  }, []);

  return (
    <div className="space-y-6">
      <OpsStaffAssignments
        key={assignmentListKey}
        unitId={unitId}
        activeQuery={activeQuery}
        listSearch={listSearch}
        onListSearchChange={(value) => dispatchPanel({ type: 'search', value })}
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={handleSort}
        onAddStaff={() => dispatchPanel({ type: 'open-add' })}
        onEditAssignment={handleEditAssignment}
      />

      <AddAssignmentDialog
        key={`${unitId}:${showAddDialog ? 'add-open' : 'add-closed'}`}
        open={showAddDialog}
        onOpenChange={handleAddDialogOpenChange}
        assignmentTypes={assignmentTypes}
        staffOptions={staffOptions}
        staffResults={staffResults}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        isSearching={isSearching}
        isPending={createAssignment.isPending}
        onSubmit={handleCreateAssignment}
      />

      <EditAssignmentDialog
        assignment={editingAssignment}
        assignmentTypes={assignmentTypes}
        isPending={updateAssignment.isPending}
        onOpenChange={handleEditDialogOpenChange}
        onSubmit={handleUpdateAssignment}
      />
    </div>
  );
}
