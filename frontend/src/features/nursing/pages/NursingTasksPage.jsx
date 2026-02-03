import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/ellipsis.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import { useState } from 'react';
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
import {
  useNursingTasks,
  useTodayTasks,
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

const TASK_TYPES = [
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

export default function NursingTasksPage() {
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
    task_type: 'assessment',
    description: '',
    scheduled_time: '',
    assigned_to: '',
    priority: 'medium',
  });
  const [completionNotes, setCompletionNotes] = useState('');

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

  // Get data
  const tasks = normalizeApiResults(tasksData);
  const patients = normalizeApiResults(patientsData);
  const nurses = staffData || [];

  // Filter tasks by search
  const filteredTasks = tasks.filter(task => {
    if (!filters.search) return true;
    const searchLower = filters.search.toLowerCase();
    return (
      task.patient_name?.toLowerCase().includes(searchLower) ||
      task.description?.toLowerCase().includes(searchLower) ||
      task.patient_mrn?.toLowerCase().includes(searchLower)
    );
  });

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
      await createMutation.mutateAsync({
        patient: newTask.patient,
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
        task_type: 'assessment',
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

  // Get priority badge color
  const getPriorityBadge = (priority) => {
    const level = PRIORITY_LEVELS.find(p => p.value === priority);
    return level ? level.color : 'bg-gray-100 text-gray-800';
  };

  // Get status badge
  const getStatusBadge = (status) => {
    const option = STATUS_OPTIONS.find(s => s.value === status);
    return option ? option.color : 'bg-gray-100 text-gray-800';
  };

  // Format scheduled time
  const formatScheduledTime = (time) => {
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
  };

  // Stats
  const stats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    overdue: tasks.filter(t => t.status === 'overdue').length,
    completed: tasks.filter(t => t.status === 'completed').length,
  };

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
        <PageHeader
          title="Nursing Tasks"
          description="Manage and track nursing tasks for patients"
          actions={(
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
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
                        onValueChange={(value) => setNewTask(prev => ({ ...prev, patient: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select patient" />
                        </SelectTrigger>
                        <SelectContent>
                          {patients.map((p) => (
                            <SelectItem key={p.patient_id} value={p.patient_id}>
                              {p.patient_name} ({p.patient_mrn})
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
                          onValueChange={(value) => setNewTask(prev => ({ ...prev, task_type: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            {TASK_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="priority">Priority</Label>
                        <Select
                          value={newTask.priority}
                          onValueChange={(value) => setNewTask(prev => ({ ...prev, priority: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select priority" />
                          </SelectTrigger>
                          <SelectContent>
                            {PRIORITY_LEVELS.map((p) => (
                              <SelectItem key={p.value} value={p.value}>
                                {p.label}
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
                      onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value }))}
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="scheduled_time">Scheduled Time *</Label>
                    <Input
                      id="scheduled_time"
                      type="datetime-local"
                      value={newTask.scheduled_time}
                      onChange={(e) => setNewTask(prev => ({ ...prev, scheduled_time: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="assigned_to">Assign To</Label>
                    <Select
                      value={newTask.assigned_to}
                      onValueChange={(value) => setNewTask(prev => ({ ...prev, assigned_to: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select nurse (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {nurses.map((n) => (
                          <SelectItem key={n.id} value={n.id}>
                            {n.full_name || n.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateTask} disabled={createMutation.isPending}>
                    {createMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Create Task'
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
        />

        <div className="container mx-auto py-6 space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Tasks</p>
                  <p className="text-2xl font-bold">{stats.total}</p>
                </div>
                <ClipboardList className="h-8 w-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Pending</p>
                  <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
                </div>
                <Clock className="h-8 w-8 text-amber-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Overdue</p>
                  <p className="text-2xl font-bold text-red-600">{stats.overdue}</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-red-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Completed Today</p>
                  <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[200px]">
                <Label htmlFor="search" className="sr-only">Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="search"
                    placeholder="Search by patient name, MRN, or description..."
                    value={filters.search}
                    onChange={(e) => handleFilterChange('search', e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="w-[150px]">
                <Label htmlFor="status-filter" className="text-xs text-muted-foreground">Status</Label>
                <Select
                  value={filters.status}
                  onValueChange={(value) => handleFilterChange('status', value)}
                >
                  <SelectTrigger id="status-filter">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="w-[150px]">
                <Label htmlFor="priority-filter" className="text-xs text-muted-foreground">Priority</Label>
                <Select
                  value={filters.priority}
                  onValueChange={(value) => handleFilterChange('priority', value)}
                >
                  <SelectTrigger id="priority-filter">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Priorities</SelectItem>
                    {PRIORITY_LEVELS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="w-[150px]">
                <Label htmlFor="type-filter" className="text-xs text-muted-foreground">Type</Label>
                <Select
                  value={filters.task_type}
                  onValueChange={(value) => handleFilterChange('task_type', value)}
                >
                  <SelectTrigger id="type-filter">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {TASK_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tasks Table */}
        <Card>
          <CardHeader>
            <CardTitle>Tasks</CardTitle>
            <CardDescription>
              {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''} found
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <ScrollArea className="h-[500px]">
                <Table>
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
                      <TableRow key={task.id}>
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
                            {TASK_TYPES.find(t => t.value === task.task_type)?.label || task.task_type}
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
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {task.status === 'pending' && (
                                <DropdownMenuItem
                                  onClick={() => handleStatusUpdate(task, 'in_progress')}
                                >
                                  Start Task
                                </DropdownMenuItem>
                              )}
                              {(task.status === 'pending' || task.status === 'in_progress') && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedTask(task);
                                    setShowCompleteDialog(true);
                                  }}
                                >
                                  Complete Task
                                </DropdownMenuItem>
                              )}
                              {task.status !== 'cancelled' && task.status !== 'completed' && (
                                <DropdownMenuItem
                                  onClick={() => handleStatusUpdate(task, 'cancelled')}
                                  className="text-red-600"
                                >
                                  Cancel Task
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
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

        {/* Complete Task Dialog */}
        <Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
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
                    onChange={(e) => setCompletionNotes(e.target.value)}
                    rows={4}
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCompleteDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCompleteTask}
                disabled={completeMutation.isPending}
                className="bg-green-600 hover:bg-green-700"
              >
                {completeMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Completing...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Complete Task
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PageShell>
  </Layout>
  );
}
