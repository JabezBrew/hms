/**
 * TeamRosterEntriesTab - Manage team roster entries
 * Chronicle Design System styling
 */
import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import Users from 'lucide-react/dist/esm/icons/users.js';
import { toast } from 'sonner';
import { teamRosterEntriesApi } from '@/features/admin/api';
import {
  useDepartmentDutyTypes,
  useDepartmentStations,
  useTeamRosterEntries,
  useCreateTeamRosterEntry,
  useUpdateTeamRosterEntry,
  useDeleteTeamRosterEntry,
} from '@/features/admin/hooks';
import { usePractitioners } from '@/features/staff/hooks';
import { toList, toValue, formatRosterName, safeDate, formatRosterTime } from './utils';
import { SELECT_ALL, SELECT_NONE } from './constants';
import { useUnitOptions } from './useUnitOptions';
import { EmptyState, RosterHeader, InlineField, FieldRow } from './components';

export function TeamRosterEntriesTab() {
  const { isLoading: unitsLoading, teams, unitById } = useUnitOptions();
  const [selectedTeam, setSelectedTeam] = useState(SELECT_ALL);
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);

  const teamFilter = selectedTeam === SELECT_ALL ? undefined : selectedTeam;

  const { data: entriesData, isLoading } = useTeamRosterEntries({
    team: teamFilter,
  });
  const entries = toList(entriesData);

  const { data: dutyTypesData } = useDepartmentDutyTypes({ include_inactive: 'true' });
  const dutyTypes = toList(dutyTypesData);

  const { data: stationsData } = useDepartmentStations({ include_inactive: 'true' });
  const stations = toList(stationsData);
  const stationById = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);

  const { data: practitionersData } = usePractitioners();
  const practitioners = Array.isArray(practitionersData)
    ? practitionersData
    : practitionersData?.results || practitionersData?.data?.results || [];
  const practitionerById = useMemo(() => new Map(practitioners.map((p) => [p.id, p])), [practitioners]);

  const createEntry = useCreateTeamRosterEntry();
  const updateEntry = useUpdateTeamRosterEntry();
  const deleteEntry = useDeleteTeamRosterEntry();

  const [formState, setFormState] = useState({
    team: '',
    date: '',
    duty_type: '',
    station: '',
    practitioner: '',
    start_time: '',
    end_time: '',
    notes: '',
  });

  useEffect(() => {
    if (!showForm) {
      setEditingEntry(null);
      setFormState({
        team: teamFilter || '',
        date: '',
        duty_type: '',
        station: '',
        practitioner: '',
        start_time: '',
        end_time: '',
        notes: '',
      });
    }
  }, [showForm, selectedTeam]);

  const openForm = async (entry) => {
    if (entry) {
      try {
        const result = await teamRosterEntriesApi.get(entry.id);
        const payload = result?.data || result;
        setEditingEntry(payload);
        setFormState({
          team: toValue(payload.team),
          date: safeDate(payload.date),
          duty_type: toValue(payload.duty_type),
          station: toValue(payload.station),
          practitioner: toValue(payload.practitioner),
          start_time: payload.start_time ? payload.start_time.slice(0, 5) : '',
          end_time: payload.end_time ? payload.end_time.slice(0, 5) : '',
          notes: payload.notes || '',
        });
      } catch (error) {
        toast.error(error.message || 'Failed to load team roster entry.');
        return;
      }
    } else {
      setEditingEntry(null);
      setFormState((prev) => ({
        ...prev,
        team: selectedTeam || prev.team,
      }));
    }
    setShowForm(true);
  };

  const handleSubmit = async () => {
    try {
      const payload = {
        team: formState.team,
        date: formState.date,
        duty_type: formState.duty_type,
        station: formState.station || null,
        practitioner: formState.practitioner,
        start_time: formState.start_time || null,
        end_time: formState.end_time || null,
        notes: formState.notes || '',
      };
      if (!payload.team || !payload.date || !payload.duty_type || !payload.practitioner) {
        toast.error('Team, date, duty type, and practitioner are required.');
        return;
      }
      if ((payload.start_time && !payload.end_time) || (!payload.start_time && payload.end_time)) {
        toast.error('Start and end time must both be set or blank.');
        return;
      }
      if (editingEntry) {
        await updateEntry.mutateAsync({ id: editingEntry.id, data: payload });
        toast.success('Team roster entry updated.');
      } else {
        await createEntry.mutateAsync(payload);
        toast.success('Team roster entry created.');
      }
      setShowForm(false);
    } catch (error) {
      toast.error(error.message || 'Failed to save team roster entry.');
    }
  };

  const handleDelete = async (entry) => {
    if (!confirm('Delete this roster entry?')) return;
    try {
      await deleteEntry.mutateAsync(entry.id);
      toast.success('Team roster entry deleted.');
    } catch (error) {
      toast.error(error.message || 'Failed to delete team roster entry.');
    }
  };

  const getPractitionerName = (practitioner) => {
    if (!practitioner) return null;
    return (
      practitioner.user?.full_name ||
      practitioner.full_name ||
      practitioner.name ||
      practitioner.display_name ||
      `${practitioner.staff_details?.user_details?.first_name || ''} ${practitioner.staff_details?.user_details?.last_name || ''}`.trim()
    );
  };

  return (
    <div className="space-y-6">
      <RosterHeader
        title="Team Roster Entries"
        subtitle="Assign practitioners and stations for specific dates."
        actions={
          <Button onClick={() => openForm(null)}>
            <Plus className="size-4 mr-2" />
            <span className="font-mono text-xs uppercase tracking-wide">Add Entry</span>
          </Button>
        }
      />

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <InlineField label="Filter by Team">
            <Select value={selectedTeam} onValueChange={setSelectedTeam}>
              <SelectTrigger>
                <SelectValue placeholder="All teams" />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                <SelectItem value={SELECT_ALL}>All teams</SelectItem>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          {unitsLoading || isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : entries.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No team roster entries yet"
              description="Add practitioner coverage to complement the department roster."
            />
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Date</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Team</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Duty Type</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Practitioner</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Station</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Timing</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry, index) => (
                    <TableRow key={entry.id} className="animate-chronicle-enter" style={{ animationDelay: `${index * 30}ms` }}>
                      <TableCell className="font-mono text-xs">{safeDate(entry.date)}</TableCell>
                      <TableCell className="text-sm">{formatRosterName(unitById.get(entry.team)?.name, entry.team_name)}</TableCell>
                      <TableCell className="text-sm">
                        {formatRosterName(dutyTypes.find((dt) => dt.id === entry.duty_type)?.name, entry.duty_type_name)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatRosterName(getPractitionerName(practitionerById.get(entry.practitioner)), entry.practitioner)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatRosterName(stationById.get(entry.station)?.name, entry.station_name)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.start_time || entry.end_time
                          ? `${formatRosterTime(entry.start_time)} - ${formatRosterTime(entry.end_time)}`
                          : 'All day'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openForm(entry)}>Edit</Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(entry)}>Delete</Button>
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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{editingEntry ? 'Edit Team Entry' : 'Add Team Entry'}</DialogTitle>
            <DialogDescription>Team entries add practitioner detail for coverage.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FieldRow>
              <InlineField label="Team">
                <Select value={formState.team} onValueChange={(v) => setFormState((p) => ({ ...p, team: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select team" /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    {teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </InlineField>
              <InlineField label="Date">
                <Input type="date" value={formState.date} onChange={(e) => setFormState((p) => ({ ...p, date: e.target.value }))} className="font-mono" />
              </InlineField>
            </FieldRow>
            <FieldRow>
              <InlineField label="Duty Type">
                <Select value={formState.duty_type} onValueChange={(v) => setFormState((p) => ({ ...p, duty_type: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    {dutyTypes.map((dt) => <SelectItem key={dt.id} value={dt.id}>{dt.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </InlineField>
              <InlineField label="Practitioner">
                <Select value={formState.practitioner} onValueChange={(v) => setFormState((p) => ({ ...p, practitioner: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    {practitioners.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {getPractitionerName(p) || p.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </InlineField>
            </FieldRow>
            <FieldRow>
              <InlineField label="Station (Optional)">
                <Select value={formState.station} onValueChange={(v) => setFormState((p) => ({ ...p, station: v }))}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    <SelectItem value={SELECT_NONE}>None</SelectItem>
                    {stations.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </InlineField>
              <InlineField label="Timing">
                <div className="grid grid-cols-2 gap-3">
                  <Input type="time" value={formState.start_time} onChange={(e) => setFormState((p) => ({ ...p, start_time: e.target.value }))} className="font-mono" placeholder="Start" />
                  <Input type="time" value={formState.end_time} onChange={(e) => setFormState((p) => ({ ...p, end_time: e.target.value }))} className="font-mono" placeholder="End" />
                </div>
              </InlineField>
            </FieldRow>
            <InlineField label="Notes (Optional)">
              <Textarea value={formState.notes} onChange={(e) => setFormState((p) => ({ ...p, notes: e.target.value }))} rows={2} />
            </InlineField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createEntry.isPending || updateEntry.isPending}>
              {editingEntry ? 'Save Changes' : 'Create Entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
