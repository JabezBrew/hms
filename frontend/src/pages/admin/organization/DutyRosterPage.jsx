import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar } from '@/components/ui/calendar';
import {
  useShiftDefinitions,
  useDutyRosterTemplates,
  useDutyRoster,
  useOnDuty,
  useCreateShiftDefinition,
  useDeleteShiftDefinition,
  useGenerateRoster,
  useSwapDuty,
} from '@/hooks/useOrganization';
import { useClinicalUnitsTree } from '@/hooks/useOrganization';

import { toast } from 'sonner';
import format from 'date-fns/format';
import startOfMonth from 'date-fns/startOfMonth';
import endOfMonth from 'date-fns/endOfMonth';
import addMonths from 'date-fns/addMonths';
import subMonths from 'date-fns/subMonths';
import eachDayOfInterval from 'date-fns/eachDayOfInterval';
import isSameMonth from 'date-fns/isSameMonth';
import isSameDay from 'date-fns/isSameDay';
import startOfWeek from 'date-fns/startOfWeek';
import endOfWeek from 'date-fns/endOfWeek';

/**
 * ShiftDefinitionsTab - Manage shift definitions
 */
function ShiftDefinitionsTab() {
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

  const shifts = data?.data?.results || data?.results || [];

  const handleCreate = async () => {
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
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-heading text-lg font-medium">Shift Definitions</h3>
          <p className="text-sm text-muted-foreground">Define the shifts used in your facility</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Shift
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Start Time</TableHead>
            <TableHead>End Time</TableHead>
            <TableHead>Crosses Midnight</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shifts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                No shift definitions yet. Create one to get started.
              </TableCell>
            </TableRow>
          ) : (
            shifts.map((shift) => (
              <TableRow key={shift.id}>
                <TableCell className="font-mono text-xs">{shift.code}</TableCell>
                <TableCell className="font-medium">{shift.name}</TableCell>
                <TableCell className="font-mono">{shift.start_time}</TableCell>
                <TableCell className="font-mono">{shift.end_time}</TableCell>
                <TableCell>
                  {shift.crosses_midnight ? (
                    <Badge variant="outline" className="bg-amber-50">Yes</Badge>
                  ) : (
                    <Badge variant="outline">No</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(shift.id)}>
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* Create Shift Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Shift Definition</DialogTitle>
            <DialogDescription>Define a new shift for your facility</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input
                  placeholder="Day Shift"
                  value={newShift.name}
                  onChange={(e) => setNewShift({ ...newShift, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Code</label>
                <Input
                  placeholder="DAY"
                  value={newShift.code}
                  onChange={(e) => setNewShift({ ...newShift, code: e.target.value.toUpperCase() })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Start Time</label>
                <Input
                  type="time"
                  value={newShift.start_time}
                  onChange={(e) => setNewShift({ ...newShift, start_time: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">End Time</label>
                <Input
                  type="time"
                  value={newShift.end_time}
                  onChange={(e) => setNewShift({ ...newShift, end_time: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newShift.name || !newShift.code || createShift.isPending}>
              {createShift.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * TemplatesTab - Manage recurring duty roster templates
 */
function TemplatesTab() {
  const { data, isLoading } = useDutyRosterTemplates();
  const templates = data?.data?.results || data?.results || [];
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-heading text-lg font-medium">Duty Templates</h3>
          <p className="text-sm text-muted-foreground">Recurring patterns for automatic roster generation</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Template
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Unit</TableHead>
            <TableHead>Practitioner</TableHead>
            <TableHead>Day</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Seniority</TableHead>
            <TableHead>Primary</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                No templates yet. Create templates to auto-generate rosters.
              </TableCell>
            </TableRow>
          ) : (
            templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell className="font-medium">{template.unit_name}</TableCell>
                <TableCell>{template.practitioner_name}</TableCell>
                <TableCell>{DAYS[template.day_of_week]}</TableCell>
                <TableCell className="font-mono text-xs">
                  {template.effective_start_time} - {template.effective_end_time}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{template.role}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn(
                    template.seniority_level === 'attending' && 'bg-emerald-50',
                    template.seniority_level === 'resident' && 'bg-sky-50',
                  )}>
                    {template.seniority_level}
                  </Badge>
                </TableCell>
                <TableCell>
                  {template.is_primary && <Badge className="bg-amber-100 text-amber-800">Primary</Badge>}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * RosterTab - View and manage actual roster entries
 */
function RosterTab() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const generateRoster = useGenerateRoster();

  const startDate = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
  const endDate = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

  const { data, isLoading } = useDutyRoster({
    date_from: startDate,
    date_to: endDate,
  });
  const entries = data?.data?.results || data?.results || [];

  const handleGenerate = async () => {
    try {
      const result = await generateRoster.mutateAsync({
        start_date: startDate,
        end_date: endDate,
      });
      toast.success(`Generated ${result.data?.entries_created || 0} roster entries`);
    } catch (error) {
      toast.error(error.message || 'Failed to generate roster');
    }
  };

  // Get entries for selected date
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const selectedEntries = entries.filter(e => e.date === selectedDateStr);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-heading text-lg font-medium">Duty Roster</h3>
          <p className="text-sm text-muted-foreground">View and manage duty assignments</p>
        </div>
        <Button onClick={handleGenerate} disabled={generateRoster.isPending}>
          <RefreshCw className={cn("h-4 w-4 mr-2", generateRoster.isPending && "animate-spin")} />
          Generate Roster
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Calendar */}
        <Card className="md:col-span-1">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(m => subMonths(m, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="font-medium">{format(currentMonth, 'MMMM yyyy')}</span>
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(m => addMonths(m, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && setSelectedDate(date)}
              month={currentMonth}
              onMonthChange={setCurrentMonth}
              className="rounded-md border"
            />
          </CardContent>
        </Card>

        {/* Selected Date Entries */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              {format(selectedDate, 'EEEE, MMMM d, yyyy')}
            </CardTitle>
            <CardDescription>
              {selectedEntries.length} duty assignment{selectedEntries.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : selectedEntries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No duty assignments for this date
              </div>
            ) : (
              <div className="space-y-3">
                {selectedEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className={cn(
                      'p-4 rounded-lg border',
                      entry.is_primary ? 'bg-amber-50 border-amber-200' : 'bg-muted/20'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{entry.practitioner_name}</span>
                          {entry.is_primary && (
                            <Badge className="bg-amber-100 text-amber-800 text-xs">Primary</Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {entry.unit_name}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm">
                          {entry.start_time} - {entry.end_time}
                        </div>
                        <div className="flex gap-1 mt-1">
                          <Badge variant="outline" className="text-xs">{entry.role}</Badge>
                          <Badge variant="outline" className="text-xs">{entry.seniority_level}</Badge>
                        </div>
                      </div>
                    </div>
                    {entry.source === 'swap' && (
                      <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                        <ArrowRightLeft className="h-3 w-3" />
                        Swapped from {entry.original_practitioner_name}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * OnDutyWidget - Shows who's currently on duty (for embedding elsewhere)
 */
export function OnDutyWidget({ unitId }) {
  const hasUnit = !!unitId;
  const { data, isLoading } = useOnDuty(hasUnit ? { unit_id: unitId } : null);
  const onDuty = data?.data?.results || data?.results || [];

  if (isLoading) {
    return <Skeleton className="h-16 w-full" />;
  }

  if (onDuty.length === 0) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm p-3 bg-muted/50 rounded-lg">
        <Users className="h-4 w-4" />
        <span>No practitioners currently on duty</span>
      </div>
    );
  }

  return (
    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="h-4 w-4 text-amber-600" />
        <span className="font-mono text-xs uppercase tracking-wider text-amber-700">
          Currently On Duty
        </span>
      </div>
      <div className="space-y-2">
        {onDuty.map((entry) => (
          <div key={entry.id} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{entry.practitioner_name}</span>
              {entry.is_primary && (
                <Badge variant="outline" className="text-[10px] bg-amber-100">
                  Primary
                </Badge>
              )}
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {entry.seniority_level} {entry.start_time}-{entry.end_time}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * DutyRosterPage - Main page for managing duty roster
 */
export default function DutyRosterPage() {
  const [activeTab, setActiveTab] = useState('roster');

  return (
    <>
      <Helmet>
        <title>Duty Roster | Organization</title>
      </Helmet>

      <div className="container max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Duty Roster Management
          </h1>
          <p className="mt-2 text-muted-foreground">
            Configure shifts, create templates, and manage duty assignments
          </p>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="roster" className="gap-2">
              <CalendarIcon className="h-4 w-4" />
              Roster
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="shifts" className="gap-2">
              <Clock className="h-4 w-4" />
              Shifts
            </TabsTrigger>
          </TabsList>

          <TabsContent value="roster">
            <RosterTab />
          </TabsContent>

          <TabsContent value="templates">
            <TemplatesTab />
          </TabsContent>

          <TabsContent value="shifts">
            <ShiftDefinitionsTab />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
