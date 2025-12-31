import { useEffect, useMemo, useState } from 'react';
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
} from '@/hooks/useOrganization';
import { useSearchStaff } from '@/hooks/useStaffQueries';
import { useDebounce } from '@/hooks/use-debounce';
import { Plus, Trash2, Users, Calendar, Star } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn, normalizeApiResults } from '@/lib/utils';

/**
 * OpsStaffPanel - Manages non-clinical staff assignments for an ops unit
 * Uses Chronicle Design System styling
 */
export function OpsStaffPanel({ unitId }) {
  const AUTO_FETCH_LIMIT = 3;
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [listSearch, setListSearch] = useState('');
  const [autoFetchAttempts, setAutoFetchAttempts] = useState(0);
  const [newAssignment, setNewAssignment] = useState({
    assignment_type: '',
    staff: '',
    is_primary: false,
    effective_from: format(new Date(), 'yyyy-MM-dd'),
    effective_until: '',
  });
  const [selectedStaff, setSelectedStaff] = useState(null);

  const debouncedSearch = useDebounce(listSearch, 300);
  const activeQuery = debouncedSearch.length >= 2 ? debouncedSearch : '';

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
  const { data: assignmentTypesData } = useAssignmentTypes();
  const createAssignment = useCreateUnitMember();
  const deleteAssignment = useDeleteUnitMember();
  const {
    data: staffSearchResults = [],
    isLoading: isSearching,
    searchTerm,
    setSearchTerm,
  } = useSearchStaff({ staffKind: 'ops' }, { minLength: 2 });

  const members = useMemo(() => {
    const pages = membersData?.pages || [];
    return pages.flatMap((page) => page.results || []);
  }, [membersData]);
  const safeLoadedCount = loadedCount ?? members.length;
  const resolvedTotalCount = totalCount ?? safeLoadedCount;
  const countLabel = totalCount == null
    ? `${safeLoadedCount} loaded`
    : `${resolvedTotalCount} total`;
  const assignmentTypes = Array.isArray(assignmentTypesData) ? assignmentTypesData : [];
  const staffResults = normalizeApiResults(staffSearchResults);
  const staffOptions = staffResults.map((member) => ({
    value: member.id,
    label: `${member.name || 'Unknown'}${member.employee_id ? ` - ${member.employee_id}` : ''}`,
  }));

  const handleAdd = async () => {
    try {
      await createAssignment.mutateAsync({
        unit: unitId,
        assignment_type: newAssignment.assignment_type,
        staff: newAssignment.staff,
        is_primary: newAssignment.is_primary,
        effective_from: newAssignment.effective_from,
        effective_until: newAssignment.effective_until || null,
      });
      toast.success('Staff assignment added');
      setShowAddDialog(false);
      setNewAssignment({
        assignment_type: '',
        staff: '',
        is_primary: false,
        effective_from: format(new Date(), 'yyyy-MM-dd'),
        effective_until: '',
      });
      setSelectedStaff(null);
      setSearchTerm('');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to add staff assignment');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteAssignment.mutateAsync(id);
      toast.success('Staff assignment removed');
    } catch {
      toast.error('Failed to remove staff assignment');
    }
  };

  const isSearchActive = activeQuery.length > 0;
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

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Operations Staff
          </h3>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {countLabel}
          </span>
        </div>
        <Button
          size="sm"
          onClick={() => setShowAddDialog(true)}
          className="bg-slate-600 hover:bg-slate-700 text-white font-mono text-xs"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add Staff
        </Button>
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
              ? `Showing ${members.length}`
              : `Showing ${members.length} of ${resolvedTotalCount}`}
          </span>
        )}
      </div>

      {members.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50 mb-3">
            <Users className="h-7 w-7 text-muted-foreground/50" />
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
        <div className="space-y-3">
          <VirtualList
            items={members}
            itemHeight={96}
            className="h-[60vh] rounded-xl border bg-card"
            onEndReached={() => {
              if (hasNextPage && !isFetchingNextPage) {
                fetchNextPage();
              }
            }}
            renderItem={(member) => (
              <div
                key={member.id}
                className={cn(
                  "flex h-24 items-center justify-between px-4 border-b border-border/60",
                  "last:border-0 hover:bg-muted/20 transition-colors"
                )}
              >
                <div className="flex min-w-0 items-center gap-4">
                  <div className="h-10 w-10 rounded-xl bg-slate-100 dark:bg-slate-900/30 flex items-center justify-center">
                    <Users className="h-5 w-5 text-slate-700 dark:text-slate-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-medium truncate">{member.staff_name}</span>
                      {member.is_primary && (
                        <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                      )}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {member.staff_employee_id || 'No employee ID'}
                    </div>
                    {member.unit_name && (
                      <div className="text-[10px] text-muted-foreground">
                        {member.unit_type_name ? `${member.unit_type_name} - ` : ''}
                        {member.unit_name}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="inline-flex font-mono text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-muted">
                      {member.assignment_type_name}
                    </span>
                    {member.effective_from && (
                      <div className="font-mono text-[10px] text-muted-foreground mt-1 flex items-center justify-end gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(member.effective_from), 'MMM d, yyyy')}
                        {member.effective_until && ` - ${format(new Date(member.effective_until), 'MMM d, yyyy')}`}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                    onClick={() => handleDelete(member.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          />
          {isFetchingNextPage && (
            <div className="text-xs text-muted-foreground">Loading more staff...</div>
          )}
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900/30">
                <Users className="h-5 w-5 text-slate-600 dark:text-slate-400" />
              </div>
              <DialogTitle className="font-display text-xl">Add Operations Staff</DialogTitle>
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
              <Label className="font-mono text-xs uppercase tracking-wider">Staff Member</Label>
              <Combobox
                options={staffOptions}
                value={newAssignment.staff}
                onChange={(value) => {
                  setNewAssignment({ ...newAssignment, staff: value || '' });
                  const selected = staffResults.find((member) => member.id === value);
                  setSelectedStaff(selected || null);
                  setSearchTerm('');
                }}
                onInputChange={setSearchTerm}
                placeholder={
                  selectedStaff
                    ? `${selectedStaff.name || 'Unknown'}${selectedStaff.employee_id ? ` - ${selectedStaff.employee_id}` : ''}`
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

            <div className="flex items-center gap-3 space-y-0 rounded-lg border p-3">
              <Checkbox
                id="ops_is_primary"
                checked={newAssignment.is_primary}
                onCheckedChange={(checked) => setNewAssignment({ ...newAssignment, is_primary: checked })}
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
              disabled={!newAssignment.assignment_type || !newAssignment.staff || createAssignment.isPending}
              className="bg-slate-600 hover:bg-slate-700 text-white font-mono text-xs"
            >
              Add Assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
