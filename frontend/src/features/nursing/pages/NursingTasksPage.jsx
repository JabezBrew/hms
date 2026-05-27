/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/ellipsis.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { toast } from 'sonner';
import format from 'date-fns/format';
import formatDistanceToNow from 'date-fns/formatDistanceToNow';
import { normalizeApiResults } from '@/lib/utils';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import {
  useNursingTasks,
  useCreateNursingTask,
  useCompleteTask,
  useUpdateTask,
} from '@/features/nursing/hooks';
import { usePatientMonitoring } from '@/features/nursing/hooks';
import { useStaff } from '@/features/staff/hooks';
import { Layout } from '@/components/layout/layout';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

const LEGACY_TASK_TYPES = [
  { value: 'medication', label: 'Medication' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'vitals', label: 'Vital Signs' },
  { value: 'wound_care', label: 'Wound Care' },
  { value: 'hygiene', label: 'Hygiene' },
  { value: 'nutrition', label: 'Nutrition' },
  { value: 'mobility', label: 'Mobility' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'other', label: 'Other' },
];

const RUST_V2_TASK_TYPES = [
  { value: 'ward_round', label: 'Ward Round' },
  { value: 'observation', label: 'Observation' },
  { value: 'medication', label: 'Medication' },
  { value: 'handoff', label: 'Handoff' },
];

const TASK_TYPE_LABELS = new Map(
  [...LEGACY_TASK_TYPES, ...RUST_V2_TASK_TYPES].map((type) => [type.value, type.label])
);

export function getTaskTypeOptions(rustV2Mode) {
  return rustV2Mode ? RUST_V2_TASK_TYPES : LEGACY_TASK_TYPES;
}

const PRIORITY_LEVELS = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-800' },
  { value: 'medium', label: 'Medium', color: 'bg-blue-100 text-blue-800' },
  { value: 'high', label: 'High', color: 'bg-amber-100 text-amber-800' },
  { value: 'urgent', label: 'Urgent', color: 'bg-red-100 text-red-800' },
];

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending', color: 'bg-gray-100 text-gray-800', icon: Clock },
  { value: 'in_progress', label: 'In Progress', color: 'bg-blue-100 text-blue-800', icon: Loader2 },
  { value: 'completed', label: 'Completed', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-gray-100 text-gray-600', icon: null },
  { value: 'overdue', label: 'Overdue', color: 'bg-red-100 text-red-800', icon: AlertTriangle },
];

function getPriorityBadge(priority) {
  const level = PRIORITY_LEVELS.find(p => p.value === priority);
  return level ? level.color : 'bg-gray-100 text-gray-800';
}

function getStatusBadge(status) {
  const option = STATUS_OPTIONS.find(s => s.value === status);
  return option ? option.color : 'bg-gray-100 text-gray-800';
}

function formatScheduledTime(time) {
  if (!time) return '-';
  const date = new Date(time);
  const now = new Date();
  if (date < now) {
    return (
      <span className="text-red-600">
        {format(date, 'MMM d, h:mm a')} ({formatDistanceToNow(date, { addSuffix: true })})
      </span>
    );
  }
  return format(date, 'MMM d, h:mm a');
}

function filterTasksBySearch(tasks, search) {
  if (!search) return tasks;
  const searchLower = search.toLowerCase();
  return tasks.filter(task => (
    task.patient_name?.toLowerCase().includes(searchLower) ||
    task.description?.toLowerCase().includes(searchLower) ||
    task.patient_mrn?.toLowerCase().includes(searchLower)
  ));
}

function buildTaskStats(tasks) {
  return {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    overdue: tasks.filter(t => t.status === 'overdue').length,
    completed: tasks.filter(t => t.status === 'completed').length,
  };
}

export default function NursingTasksPage() {
  const rustV2Mode = isRustV2ApiMode();
  const taskTypes = getTaskTypeOptions(rustV2Mode);
  const defaultTaskType = rustV2Mode ? 'observation' : 'assessment';
  const [filters, setFilters] = useState({
    status: 'all',
    priority: 'all',
    task_type: 'all',
    search: '',
  });
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [newTask, setNewTask] = useState({
    patient: '',
    task_type: defaultTaskType,
    description: '',
    scheduled_time: '',
    assigned_to: '',
    priority: 'medium',
  });
  const [completionNotes, setCompletionNotes] = useState('');
  const generalTaskEditsAvailable = !rustV2Mode;

  // Fetch tasks
  const { data: tasksData, isLoading, refetch } = useNursingTasks({
    status: filters.status !== 'all' ? filters.status : undefined,
    priority: filters.priority !== 'all' ? filters.priority : undefined,
    task_type: filters.task_type !== 'all' ? filters.task_type : undefined,
  });

  // Fetch patients for task creation
  const { data: patientsData } = usePatientMonitoring(null, 1, 100);

  // Fetch staff for assignment
  const { data: staffData } = useStaff({ role: 'nurse' });

  // Mutations
  const createMutation = useCreateNursingTask();
  const completeMutation = useCompleteTask();
  const updateMutation = useUpdateTask();

  const tasks = useMemo(() => normalizeApiResults(tasksData), [tasksData]);
  const patients = useMemo(() => normalizeApiResults(patientsData), [patientsData]);
  const nurses = staffData || [];
  const filteredTasks = useMemo(
    () => filterTasksBySearch(tasks, filters.search),
    [filters.search, tasks]
  );

  // Handle filter change
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  // Handle create task
  const handleCreateTask = async () => {
    if (!newTask.patient || !newTask.description || !newTask.scheduled_time) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      const selectedPatient = patients.find((patient) => patient.patient_id === newTask.patient);
      await createMutation.mutateAsync({
        patient: newTask.patient,
        admission_case_id: selectedPatient?.admission_id || selectedPatient?.admission?.id,
        task_type: newTask.task_type,
        description: newTask.description,
        scheduled_time: newTask.scheduled_time,
        assigned_to: newTask.assigned_to || undefined,
        priority: newTask.priority,
      });

      toast.success('Task created successfully');
      setShowCreateDialog(false);
      setNewTask({
        patient: '',
        task_type: defaultTaskType,
        description: '',
        scheduled_time: '',
        assigned_to: '',
        priority: 'medium',
      });
    } catch (error) {
      console.error('Error creating task:', error);
      toast.error('Failed to create task');
    }
  };

  // Handle complete task
  const handleCompleteTask = async () => {
    if (!selectedTask) return;

    try {
      await completeMutation.mutateAsync({
        taskId: selectedTask.id,
        completion_notes: completionNotes,
      });

      toast.success('Task completed successfully');
      setShowCompleteDialog(false);
      setSelectedTask(null);
      setCompletionNotes('');
    } catch (error) {
      console.error('Error completing task:', error);
      toast.error('Failed to complete task');
    }
  };

  // Handle status update
  const handleStatusUpdate = async (task, newStatus) => {
    if (rustV2Mode && !['completed', 'cancelled'].includes(newStatus)) {
      toast.error('General nursing task edits are not available for this deployment yet.');
      return;
    }

    try {
      await updateMutation.mutateAsync({
        taskId: task.id,
        status: newStatus,
      });
      toast.success(`Task marked as ${newStatus.replace('_', ' ')}`);
    } catch (error) {
      console.error('Error updating task:', error);
      toast.error('Failed to update task');
    }
  };

  const stats = useMemo(() => buildTaskStats(tasks), [tasks]);

  const pageMeta = usePageMeta({
    title: 'Nursing Tasks | HMS',
    breadcrumbs: [
      { label: 'Nursing', href: '/nursing/dashboard' },
      { label: 'Tasks' },
    ],
  });

  return (
    <Layout>
      <PageShell>
        {pageMeta}
        <NursingTasksHeader
          createMutation={createMutation}
          newTask={newTask}
          nurses={nurses}
          patients={patients}
          showCreateDialog={showCreateDialog}
          taskTypes={taskTypes}
          onCreateTask={handleCreateTask}
          onNewTaskChange={setNewTask}
          onRefresh={refetch}
          onShowCreateDialogChange={setShowCreateDialog}
        />

        <div className="container mx-auto py-6 space-y-6">
          <NursingTaskStats stats={stats} />
          <RustV2TaskEditNotice rustV2Mode={rustV2Mode} />
          <NursingTaskFilters
            filters={filters}
            taskTypes={taskTypes}
            onFilterChange={handleFilterChange}
          />
          <NursingTaskTable
            filteredTasks={filteredTasks}
            generalTaskEditsAvailable={generalTaskEditsAvailable}
            isLoading={isLoading}
            onCompleteTask={(task) => {
              setSelectedTask(task);
              setShowCompleteDialog(true);
            }}
            onStatusUpdate={handleStatusUpdate}
          />
          <CompleteTaskDialog
            completionNotes={completionNotes}
            completeMutation={completeMutation}
            open={showCompleteDialog}
            selectedTask={selectedTask}
            onCompletionNotesChange={setCompletionNotes}
            onCompleteTask={handleCompleteTask}
            onOpenChange={setShowCompleteDialog}
          />
        </div>
      </PageShell>
    </Layout>
  );
}

function NursingTasksHeader({
  createMutation,
  newTask,
  nurses,
  patients,
  showCreateDialog,
  taskTypes,
  onCreateTask,
  onNewTaskChange,
  onRefresh,
  onShowCreateDialogChange,
}) {
  return (
    <PageHeader
      title="Nursing Tasks"
      description="Manage and track nursing tasks for patients"
      actions={(
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => onRefresh()}>
            <RefreshCw className="mr-2 size-4" />
            Refresh
          </Button>
          <CreateTaskDialog
            createMutation={createMutation}
            newTask={newTask}
            nurses={nurses}
            open={showCreateDialog}
            patients={patients}
            taskTypes={taskTypes}
            onCreateTask={onCreateTask}
            onNewTaskChange={onNewTaskChange}
            onOpenChange={onShowCreateDialogChange}
          />
        </div>
      )}
    />
  );
}

function CreateTaskDialog({
  createMutation,
  newTask,
  nurses,
  open,
  patients,
  taskTypes,
  onCreateTask,
  onNewTaskChange,
  onOpenChange,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" />
          New Task
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
          <DialogDescription>
            Assign a new nursing task to a patient
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="patient">Patient *</Label>
            <Select
              value={newTask.patient}
              onValueChange={(value) => onNewTaskChange(prev => ({ ...prev, patient: value }))}
            >
              <SelectTrigger id="patient">
                <SelectValue placeholder="Select patient" />
              </SelectTrigger>
              <SelectContent>
                {patients.map((patient) => (
                  <SelectItem key={patient.patient_id} value={patient.patient_id}>
                    {patient.patient_name} ({patient.patient_mrn})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="task_type">Task Type *</Label>
              <Select
                value={newTask.task_type}
                onValueChange={(value) => onNewTaskChange(prev => ({ ...prev, task_type: value }))}
              >
                <SelectTrigger id="task_type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {taskTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select
                value={newTask.priority}
                onValueChange={(value) => onNewTaskChange(prev => ({ ...prev, priority: value }))}
              >
                <SelectTrigger id="priority">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_LEVELS.map((priority) => (
                    <SelectItem key={priority.value} value={priority.value}>
                      {priority.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              placeholder="Describe the task..."
              value={newTask.description}
              onChange={(event) => onNewTaskChange(prev => ({ ...prev, description: event.target.value }))}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="scheduled_time">Scheduled Time *</Label>
            <Input
              id="scheduled_time"
              type="datetime-local"
              value={newTask.scheduled_time}
              onChange={(event) => onNewTaskChange(prev => ({ ...prev, scheduled_time: event.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="assigned_to">Assign To</Label>
            <Select
              value={newTask.assigned_to}
              onValueChange={(value) => onNewTaskChange(prev => ({ ...prev, assigned_to: value }))}
            >
              <SelectTrigger id="assigned_to">
                <SelectValue placeholder="Select nurse (optional)" />
              </SelectTrigger>
              <SelectContent>
                {nurses.map((nurse) => (
                  <SelectItem key={nurse.id} value={nurse.id}>
                    {nurse.full_name || nurse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onCreateTask} disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Creating…
              </>
            ) : (
              'Create Task'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NursingTaskStats({ stats }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <TaskStatCard
        title="Total Tasks"
        value={stats.total}
        icon={ClipboardList}
        iconClassName="text-muted-foreground"
      />
      <TaskStatCard
        title="Pending"
        value={stats.pending}
        icon={Clock}
        iconClassName="text-amber-500"
        valueClassName="text-amber-600"
      />
      <TaskStatCard
        title="Overdue"
        value={stats.overdue}
        icon={AlertTriangle}
        iconClassName="text-red-500"
        valueClassName="text-red-600"
      />
      <TaskStatCard
        title="Completed Today"
        value={stats.completed}
        icon={CheckCircle}
        iconClassName="text-green-500"
        valueClassName="text-green-600"
      />
    </div>
  );
}

function TaskStatCard({ title, value, icon: Icon, iconClassName, valueClassName }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={`text-2xl font-bold ${valueClassName || ''}`}>{value}</p>
          </div>
          <Icon className={`size-8 ${iconClassName}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function RustV2TaskEditNotice({ rustV2Mode }) {
  if (!rustV2Mode) {
    return null;
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
      General nursing task edits are not available for this deployment yet. Complete and cancel actions remain available.
    </div>
  );
}

function NursingTaskFilters({ filters, taskTypes, onFilterChange }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="search" className="sr-only">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                id="search"
                placeholder="Search by patient name, MRN, or description..."
                value={filters.search}
                onChange={(event) => onFilterChange('search', event.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <TaskSelectFilter
            label="Status"
            id="status-filter"
            value={filters.status}
            allLabel="All Statuses"
            options={STATUS_OPTIONS}
            onValueChange={(value) => onFilterChange('status', value)}
          />
          <TaskSelectFilter
            label="Priority"
            id="priority-filter"
            value={filters.priority}
            allLabel="All Priorities"
            options={PRIORITY_LEVELS}
            onValueChange={(value) => onFilterChange('priority', value)}
          />
          <TaskSelectFilter
            label="Type"
            id="type-filter"
            value={filters.task_type}
            allLabel="All Types"
            options={taskTypes}
            onValueChange={(value) => onFilterChange('task_type', value)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function TaskSelectFilter({ label, id, value, allLabel, options, onValueChange }) {
  return (
    <div className="w-[150px]">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function NursingTaskTable({
  filteredTasks,
  generalTaskEditsAvailable,
  isLoading,
  onCompleteTask,
  onStatusUpdate,
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasks</CardTitle>
        <CardDescription>
          {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''} found
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <TaskTableSkeleton />
        ) : (
          <ScrollArea className="h-[500px] max-w-full">
            <Table className="min-w-[920px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTasks.map((task) => (
                  <NursingTaskRow
                    key={task.id}
                    generalTaskEditsAvailable={generalTaskEditsAvailable}
                    task={task}
                    onCompleteTask={onCompleteTask}
                    onStatusUpdate={onStatusUpdate}
                  />
                ))}

                {filteredTasks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No tasks found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function TaskTableSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

function NursingTaskRow({
  generalTaskEditsAvailable,
  task,
  onCompleteTask,
  onStatusUpdate,
}) {
  return (
    <TableRow>
      <TableCell>
        <div>
          <p className="font-medium">{task.patient_name}</p>
          <p className="text-xs text-muted-foreground">{task.patient_mrn}</p>
        </div>
      </TableCell>
      <TableCell className="max-w-[200px]">
        <p className="truncate">{task.description}</p>
      </TableCell>
      <TableCell>
        <Badge variant="outline">
          {TASK_TYPE_LABELS.get(task.task_type) || task.task_type}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge className={getPriorityBadge(task.priority)}>
          {PRIORITY_LEVELS.find(p => p.value === task.priority)?.label || task.priority}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge className={getStatusBadge(task.status)}>
          {STATUS_OPTIONS.find(s => s.value === task.status)?.label || task.status}
        </Badge>
      </TableCell>
      <TableCell>{formatScheduledTime(task.scheduled_time)}</TableCell>
      <TableCell>{task.assigned_to_name || '-'}</TableCell>
      <TableCell>
        <NursingTaskActions
          generalTaskEditsAvailable={generalTaskEditsAvailable}
          task={task}
          onCompleteTask={onCompleteTask}
          onStatusUpdate={onStatusUpdate}
        />
      </TableCell>
    </TableRow>
  );
}

function NursingTaskActions({
  generalTaskEditsAvailable,
  task,
  onCompleteTask,
  onStatusUpdate,
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {task.status === 'pending' && generalTaskEditsAvailable && (
          <DropdownMenuItem onClick={() => onStatusUpdate(task, 'in_progress')}>
            Start Task
          </DropdownMenuItem>
        )}
        {(task.status === 'pending' || task.status === 'in_progress') && (
          <DropdownMenuItem onClick={() => onCompleteTask(task)}>
            Complete Task
          </DropdownMenuItem>
        )}
        {task.status !== 'cancelled' && task.status !== 'completed' && (
          <DropdownMenuItem
            onClick={() => onStatusUpdate(task, 'cancelled')}
            className="text-red-600"
          >
            Cancel Task
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CompleteTaskDialog({
  completionNotes,
  completeMutation,
  open,
  selectedTask,
  onCompletionNotesChange,
  onCompleteTask,
  onOpenChange,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete Task</DialogTitle>
          <DialogDescription>
            Mark this task as completed
          </DialogDescription>
        </DialogHeader>
        {selectedTask && (
          <div className="space-y-4 py-4">
            <div className="p-4 bg-accent rounded-lg">
              <p className="font-medium">{selectedTask.description}</p>
              <p className="text-sm text-muted-foreground mt-1">
                Patient: {selectedTask.patient_name}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="completion_notes">Completion Notes</Label>
              <Textarea
                id="completion_notes"
                placeholder="Add any notes about the task completion..."
                value={completionNotes}
                onChange={(event) => onCompletionNotesChange(event.target.value)}
                rows={4}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onCompleteTask}
            disabled={completeMutation.isPending}
            className="bg-green-600 hover:bg-green-700"
          >
            {completeMutation.isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Completing…
              </>
            ) : (
              <>
                <CheckCircle className="mr-2 size-4" />
                Complete Task
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
