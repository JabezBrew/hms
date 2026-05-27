/**
 * TeamRosterEntriesTab - Manage team roster entries
 * Chronicle Design System styling
 */
import { useReducer, useState, useMemo } from 'react';
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

function createBlankTeamEntryForm(team = '') {
  return {
    team,
    date: '',
    duty_type: '',
    station: SELECT_NONE,
    practitioner: '',
    start_time: '',
    end_time: '',
    notes: '',
  };
}

function createTeamEntryFormState({ entry, team }) {
  if (!entry) {
    return createBlankTeamEntryForm(team);
  }
  return {
    team: toValue(entry.team),
    date: safeDate(entry.date),
    duty_type: toValue(entry.duty_type),
    station: toValue(entry.station) || SELECT_NONE,
    practitioner: toValue(entry.practitioner),
    start_time: entry.start_time ? entry.start_time.slice(0, 5) : '',
    end_time: entry.end_time ? entry.end_time.slice(0, 5) : '',
    notes: entry.notes || '',
  };
}

function teamEntryFormReducer(state, action) {
  if (action.type === 'field') {
    return { ...state, [action.name]: action.value };
  }
  return state;
}

function TeamEntryFormDialog({
  createEntry,
  dutyTypes,
  editingEntry,
  getPractitionerName,
  onOpenChange,
  open,
  practitioners,
  selectedTeam,
  stations,
  teams,
  updateEntry,
}) {
  const team = selectedTeam === SELECT_ALL ? '' : selectedTeam;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <TeamEntryFormContent
          key={editingEntry ? editingEntry.id : `new-${team || 'all'}`}
          createEntry={createEntry}
          dutyTypes={dutyTypes}
          editingEntry={editingEntry}
          getPractitionerName={getPractitionerName}
          initialTeam={team}
          onClose={() => onOpenChange(false)}
          practitioners={practitioners}
          stations={stations}
          teams={teams}
          updateEntry={updateEntry}
        />
      ) : null}
    </Dialog>
  );
}

function TeamEntryFormContent({
  createEntry,
  dutyTypes,
  editingEntry,
  getPractitionerName,
  initialTeam,
  onClose,
  practitioners,
  stations,
  teams,
  updateEntry,
}) {
  const [formState, dispatchForm] = useReducer(
    teamEntryFormReducer,
    { entry: editingEntry, team: initialTeam },
    createTeamEntryFormState,
  );

  const updateField = (name) => (value) => dispatchForm({ type: 'field', name, value });
  const updateInputField = (name) => (event) => updateField(name)(event.target.value);

  const handleSubmit = async () => {
    try {
      const payload = {
        team: formState.team,
        date: formState.date,
        duty_type: formState.duty_type,
        station: formState.station === SELECT_NONE ? null : (formState.station || null),
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
      onClose();
    } catch (error) {
      toast.error(error.message || 'Failed to save team roster entry.');
    }
  };

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="font-display text-xl">{editingEntry ? 'Edit Team Entry' : 'Add Team Entry'}</DialogTitle>
        <DialogDescription>Team entries add practitioner detail for coverage.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <FieldRow>
          <InlineField label="Team">
            <Select value={formState.team} onValueChange={updateField('team')}>
              <SelectTrigger><SelectValue placeholder="Select team" /></SelectTrigger>
              <SelectContent className="z-[200]">
                {teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </InlineField>
          <InlineField label="Date">
            <Input type="date" value={formState.date} onChange={updateInputField('date')} className="font-mono" />
          </InlineField>
        </FieldRow>
        <FieldRow>
          <InlineField label="Duty Type">
            <Select value={formState.duty_type} onValueChange={updateField('duty_type')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent className="z-[200]">
                {dutyTypes.map((dt) => <SelectItem key={dt.id} value={dt.id}>{dt.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </InlineField>
          <InlineField label="Practitioner">
            <Select value={formState.practitioner} onValueChange={updateField('practitioner')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent className="z-[200]">
                {practitioners.map((practitioner) => (
                  <SelectItem key={practitioner.id} value={practitioner.id}>
                    {getPractitionerName(practitioner) || practitioner.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>
        </FieldRow>
        <FieldRow>
          <InlineField label="Station (Optional)">
            <Select value={formState.station} onValueChange={updateField('station')}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent className="z-[200]">
                <SelectItem value={SELECT_NONE}>None</SelectItem>
                {stations.map((station) => <SelectItem key={station.id} value={station.id}>{station.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </InlineField>
          <InlineField label="Timing">
            <div className="grid grid-cols-2 gap-3">
              <Input type="time" value={formState.start_time} onChange={updateInputField('start_time')} className="font-mono" placeholder="Start" />
              <Input type="time" value={formState.end_time} onChange={updateInputField('end_time')} className="font-mono" placeholder="End" />
            </div>
          </InlineField>
        </FieldRow>
        <InlineField label="Notes (Optional)">
          <Textarea value={formState.notes} onChange={updateInputField('notes')} rows={2} />
        </InlineField>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={createEntry.isPending || updateEntry.isPending}>
          {editingEntry ? 'Save Changes' : 'Create Entry'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function TeamRosterEntriesTab() {
  const { isLoading: unitsLoading, teams, unitById } = useUnitOptions();
  const [selectedTeam, setSelectedTeam] = useState(SELECT_ALL);
  const [formDialog, setFormDialog] = useState({
    editingEntry: null,
    open: false,
  });

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
  const practitioners = useMemo(() => (
    Array.isArray(practitionersData)
      ? practitionersData
      : practitionersData?.results || practitionersData?.data?.results || []
  ), [practitionersData]);
  const practitionerById = useMemo(() => new Map(practitioners.map((p) => [p.id, p])), [practitioners]);

  const createEntry = useCreateTeamRosterEntry();
  const updateEntry = useUpdateTeamRosterEntry();
  const deleteEntry = useDeleteTeamRosterEntry();

  const openForm = async (entry) => {
    if (entry) {
      try {
        const result = await teamRosterEntriesApi.get(entry.id);
        const payload = result?.data || result;
        setFormDialog({ editingEntry: payload, open: true });
      } catch (error) {
        toast.error(error.message || 'Failed to load team roster entry.');
      }
    } else {
      setFormDialog({ editingEntry: null, open: true });
    }
  };

  const handleFormOpenChange = (open) => {
    if (!open) {
      setFormDialog({ editingEntry: null, open: false });
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

      <TeamEntryFormDialog
        createEntry={createEntry}
        dutyTypes={dutyTypes}
        editingEntry={formDialog.editingEntry}
        getPractitionerName={getPractitionerName}
        onOpenChange={handleFormOpenChange}
        open={formDialog.open}
        practitioners={practitioners}
        selectedTeam={selectedTeam}
        stations={stations}
        teams={teams}
        updateEntry={updateEntry}
      />
    </div>
  );
}
