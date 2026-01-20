/**
 * ShiftDefinitionsTab - Manage shift definitions
 * Chronicle Design System styling
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { toast } from 'sonner';
import { useShiftDefinitions, useCreateShiftDefinition, useDeleteShiftDefinition } from '@/hooks/useOrganization';
import { toList } from './utils';
import { EmptyState, RosterHeader, InlineField, FieldRow } from './components';

export function ShiftDefinitionsTab() {
  const { data, isLoading } = useShiftDefinitions();
  const createShift = useCreateShiftDefinition();
  const deleteShift = useDeleteShiftDefinition();
  const [showCreate, setShowCreate] = useState(false);
  const [newShift, setNewShift] = useState({
    name: '',
    code: '',
    start_time: '07:00',
    end_time: '15:00',
  });

  const shifts = toList(data);

  const handleCreate = async () => {
    if (!newShift.name.trim() || !newShift.code.trim()) {
      toast.error('Name and code are required.');
      return;
    }
    try {
      await createShift.mutateAsync(newShift);
      toast.success('Shift definition created');
      setShowCreate(false);
      setNewShift({ name: '', code: '', start_time: '07:00', end_time: '15:00' });
    } catch (error) {
      toast.error(error.message || 'Failed to create shift');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this shift definition?')) return;
    try {
      await deleteShift.mutateAsync(id);
      toast.success('Shift definition deleted');
    } catch (error) {
      toast.error(error.message || 'Failed to delete shift');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <RosterHeader
        title="Shift Definitions"
        subtitle="Define the shifts used across your facility."
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            <span className="font-mono text-xs uppercase tracking-wide">Add Shift</span>
          </Button>
        }
      />

      {shifts.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No shift definitions yet"
          description="Create shifts to define working hours for your facility."
          action={
            <Button onClick={() => setShowCreate(true)} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Create First Shift
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">Code</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">Name</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">Start</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">End</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider">Overnight</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-wider w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts.map((shift, index) => (
                <TableRow
                  key={shift.id}
                  className="animate-chronicle-enter"
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <TableCell className="font-mono text-xs font-medium">{shift.code}</TableCell>
                  <TableCell className="font-heading font-medium">{shift.name}</TableCell>
                  <TableCell className="font-mono text-xs">{shift.start_time}</TableCell>
                  <TableCell className="font-mono text-xs">{shift.end_time}</TableCell>
                  <TableCell>
                    {shift.crosses_midnight ? (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[10px] font-mono">
                        Yes
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] font-mono">No</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(shift.id)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create Shift Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Create Shift Definition</DialogTitle>
            <DialogDescription className="text-sm">
              Define a new shift for your facility scheduling.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <FieldRow>
              <InlineField label="Name">
                <Input
                  placeholder="Day Shift"
                  value={newShift.name}
                  onChange={(e) => setNewShift({ ...newShift, name: e.target.value })}
                />
              </InlineField>
              <InlineField label="Code">
                <Input
                  placeholder="DAY"
                  value={newShift.code}
                  onChange={(e) => setNewShift({ ...newShift, code: e.target.value.toUpperCase() })}
                  className="font-mono"
                />
              </InlineField>
            </FieldRow>
            <FieldRow>
              <InlineField label="Start Time">
                <Input
                  type="time"
                  value={newShift.start_time}
                  onChange={(e) => setNewShift({ ...newShift, start_time: e.target.value })}
                  className="font-mono"
                />
              </InlineField>
              <InlineField label="End Time">
                <Input
                  type="time"
                  value={newShift.end_time}
                  onChange={(e) => setNewShift({ ...newShift, end_time: e.target.value })}
                  className="font-mono"
                />
              </InlineField>
            </FieldRow>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newShift.name || !newShift.code || createShift.isPending}
            >
              {createShift.isPending ? 'Creating...' : 'Create Shift'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
