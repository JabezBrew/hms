import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import UserCog from 'lucide-react/dist/esm/icons/user-cog.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import { useState } from 'react';
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
import { Combobox } from '@/components/ui/combobox';
import {
  useUnitLeaders,
  useLeadershipRoles,
  useCreateLeadershipAssignment,
  useDeleteLeadershipAssignment,
} from '@/features/admin/hooks';
import { useSearchStaff } from '@/features/staff/hooks';

import format from 'date-fns/format';
import { toast } from 'sonner';
import { cn, normalizeApiResults } from '@/lib/utils';

/**
 * LeadershipPanel - Manages leadership assignments for a clinical unit
 * Uses Chronicle Design System styling
 */
export function LeadershipPanel({ unitId }) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newLeadership, setNewLeadership] = useState({
    role: '',
    user: '',
    effective_from: format(new Date(), 'yyyy-MM-dd'),
    effective_until: '',
  });
  const [selectedLeader, setSelectedLeader] = useState(null);

  const { data: leadersData, isLoading } = useUnitLeaders(unitId);
  const { data: rolesData } = useLeadershipRoles();
  const createLeadership = useCreateLeadershipAssignment();
  const deleteLeadership = useDeleteLeadershipAssignment();
  const {
    data: staffSearchResults = [],
    isLoading: isSearching,
    searchTerm,
    setSearchTerm,
  } = useSearchStaff({}, { minLength: 2 });

  const leaders = leadersData?.data || leadersData || [];
  const roles = Array.isArray(rolesData) ? rolesData : [];
  const staffResults = normalizeApiResults(staffSearchResults);
  const staffOptions = staffResults.map((staff) => ({
    value: staff.user_id,
    label: `${staff.name || 'Unknown'}${staff.employee_id ? ` • ${staff.employee_id}` : ''}`,
  }));

  const handleAdd = async () => {
    try {
      await createLeadership.mutateAsync({
        unit: unitId,
        role: newLeadership.role,
        user: newLeadership.user,
        effective_from: newLeadership.effective_from,
        effective_until: newLeadership.effective_until || null,
      });
      toast.success('Leadership assignment added');
      setShowAddDialog(false);
      setNewLeadership({
        role: '',
        user: '',
        effective_from: format(new Date(), 'yyyy-MM-dd'),
        effective_until: '',
      });
      setSelectedLeader(null);
      setSearchTerm('');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to add leadership');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteLeadership.mutateAsync(id);
      toast.success('Leadership assignment removed');
    } catch (error) {
      toast.error('Failed to remove leadership');
    }
  };

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
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Leadership Assignments
        </h3>
        <Button
          size="sm"
          onClick={() => setShowAddDialog(true)}
          className="bg-amber-600 hover:bg-amber-700 text-white font-mono text-xs"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add Leader
        </Button>
      </div>

      {leaders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50 mb-3">
            <UserCog className="h-7 w-7 text-muted-foreground/50" />
          </div>
          <p className="text-sm text-muted-foreground">No leadership assignments</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Add leaders to manage this unit</p>
        </div>
      ) : (
        <div className="space-y-3">
          {leaders.map((leader, index) => (
            <div
              key={leader.id}
              className={cn(
                "group flex items-center justify-between p-4 rounded-xl border transition-all duration-200",
                "hover:border-amber-200 dark:hover:border-amber-800 hover:shadow-sm",
                "animate-chronicle-enter",
              )}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-center gap-4">
                <div className="h-11 w-11 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <UserCog className="h-5 w-5 text-amber-700 dark:text-amber-400" />
                </div>
                <div>
                  <div className="font-display font-medium">{leader.user_name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{leader.user_email}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <span className="inline-flex font-mono text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-muted">
                    {leader.role_name}
                  </span>
                  <div className="font-mono text-[10px] text-muted-foreground mt-1.5 flex items-center justify-end gap-1">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(leader.effective_from), 'MMM d, yyyy')}
                    {leader.effective_until && ` — ${format(new Date(leader.effective_until), 'MMM d, yyyy')}`}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                  onClick={() => handleDelete(leader.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
                <UserCog className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <DialogTitle className="font-display text-xl">Add Leadership Assignment</DialogTitle>
            </div>
          </DialogHeader>
          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Role</Label>
              <Select
                value={newLeadership.role}
                onValueChange={(value) => setNewLeadership({ ...newLeadership, role: value })}
              >
                <SelectTrigger className="font-mono text-sm">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id.toString()}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Leader</Label>
              <Combobox
                options={staffOptions}
                value={newLeadership.user}
                onChange={(value) => {
                  setNewLeadership({ ...newLeadership, user: value || '' });
                  const selected = staffResults.find((staff) => staff.user_id === value);
                  setSelectedLeader(selected || null);
                  setSearchTerm('');
                }}
                onInputChange={setSearchTerm}
                placeholder={selectedLeader?.name || 'Search by name or employee ID...'}
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
              <p className="text-[10px] text-muted-foreground">
                Search by name or employee ID
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Effective From</Label>
                <Input
                  type="date"
                  value={newLeadership.effective_from}
                  onChange={(e) => setNewLeadership({ ...newLeadership, effective_from: e.target.value })}
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Effective Until</Label>
                <Input
                  type="date"
                  value={newLeadership.effective_until}
                  onChange={(e) => setNewLeadership({ ...newLeadership, effective_until: e.target.value })}
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
              disabled={!newLeadership.role || !newLeadership.user || createLeadership.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white font-mono text-xs"
            >
              Add Assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
