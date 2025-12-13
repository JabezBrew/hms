import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  Plus,
  Clock,
  Calendar,
  User,
  Video,
  ChevronRight,
  Inbox,
  Pill,
  FlaskConical,
  FileText,
  AlertTriangle,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SlideOver } from '@/components/ui/SlideOver';

// Mock Data (to be replaced with real API data)
const mockAppointments = [
  {
    id: '1',
    patientName: 'Sarah Johnson',
    patientImage: '',
    time: '09:00',
    type: 'Follow-up',
    chiefComplaint: 'Hypertension follow-up, reports dizziness',
    status: 'in-room'
  },
  {
    id: '2',
    patientName: 'Michael Chen',
    patientImage: '',
    time: '09:30',
    type: 'New Visit',
    chiefComplaint: 'Right knee pain after hiking',
    status: 'checked-in'
  },
  {
    id: '3',
    patientName: 'Emma Davis',
    patientImage: '',
    time: '10:00',
    type: 'Telehealth',
    chiefComplaint: 'Anxiety medication review',
    status: 'telehealth-active'
  },
  {
    id: '4',
    patientName: 'James Wilson',
    patientImage: '',
    time: '10:30',
    type: 'Annual',
    chiefComplaint: 'Annual physical exam',
    status: 'upcoming'
  },
  {
    id: '5',
    patientName: 'Linda Martinez',
    patientImage: '',
    time: '11:00',
    type: 'Follow-up',
    chiefComplaint: 'Diabetes management',
    status: 'upcoming'
  }
];

const mockTasks = [
  {
    id: 't1',
    type: 'Refill',
    priority: 'Routine',
    patientName: 'Robert Taylor',
    details: 'Lisinopril 10mg - 90 day supply',
    status: 'Pending'
  },
  {
    id: 't2',
    type: 'LabReview',
    priority: 'Urgent',
    patientName: 'Sarah Johnson',
    details: 'Elevated Potassium (5.8)',
    status: 'Pending'
  },
  {
    id: 't3',
    type: 'SignNote',
    priority: 'Routine',
    patientName: 'Michael Chen',
    details: 'Office Visit - Knee Pain',
    status: 'Pending'
  },
  {
    id: 't4',
    type: 'Refill',
    priority: 'Routine',
    patientName: 'Emily White',
    details: 'Metformin 500mg',
    status: 'Pending'
  }
];

export default function ProviderDashboard() {
  const navigate = useNavigate();
  const [selectedTask, setSelectedTask] = useState(null);

  const todayDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

  const urgentTasks = mockTasks.filter(t => t.priority === 'Urgent');

  return (
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <header className="bg-card border-b border-border px-6 py-8">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest mb-2">
              {todayDate}
            </p>
            <h1 className="font-display text-4xl text-foreground tracking-tight">
              Command Center
            </h1>
            <p className="text-muted-foreground mt-2">
              {mockAppointments.length} appointments · {mockTasks.length} tasks pending
            </p>
          </div>
          <Button
            onClick={() => navigate('/appointments/create')}
            className="font-mono text-xs"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Appointment
          </Button>
        </div>
      </header>

      <main className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Up Next Stream */}
          <div className="lg:col-span-7 space-y-6">
            {/* Urgent Alert Banner */}
            {urgentTasks.length > 0 && (
              <article className={cn(
                "relative bg-[oklch(0.65_0.22_15_/_0.1)] border border-[oklch(0.65_0.22_15_/_0.3)] rounded-2xl p-4",
                "animate-chronicle-enter"
              )}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[oklch(0.65_0.22_15_/_0.2)] flex items-center justify-center">
                    <AlertTriangle className="h-5 w-5 text-[oklch(0.65_0.22_15)]" />
                  </div>
                  <div className="flex-1">
                    <p className="font-mono text-xs uppercase tracking-widest text-[oklch(0.65_0.22_15)]">
                      Urgent Attention Required
                    </p>
                    <p className="text-sm text-foreground mt-1">
                      {urgentTasks.length} urgent {urgentTasks.length === 1 ? 'task' : 'tasks'} need your review
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="font-mono text-xs border-[oklch(0.65_0.22_15_/_0.3)] text-[oklch(0.65_0.22_15)] hover:bg-[oklch(0.65_0.22_15_/_0.1)]"
                    onClick={() => setSelectedTask(urgentTasks[0])}
                  >
                    Review Now
                  </Button>
                </div>
              </article>
            )}

            {/* Up Next Section */}
            <section>
              <header className="flex items-center gap-3 mb-4">
                <Calendar className="h-5 w-5 text-muted-foreground" />
                <h2 className="font-display text-2xl text-foreground">Up Next</h2>
                <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  {mockAppointments.length}
                </span>
              </header>

              <div className="space-y-3">
                {mockAppointments.map((appointment, index) => (
                  <ChronicleAppointmentCard
                    key={appointment.id}
                    appointment={appointment}
                    index={index}
                    onClick={() => navigate(`/encounters/${appointment.id}`)}
                  />
                ))}

                <div className="py-6 text-center">
                  <p className="font-mono text-xs text-muted-foreground">
                    End of scheduled appointments
                  </p>
                </div>
              </div>
            </section>
          </div>

          {/* Right Column: Inbox */}
          <div className="lg:col-span-5">
            <ChronicleInbox
              tasks={mockTasks}
              selectedTask={selectedTask}
              onSelectTask={setSelectedTask}
            />
          </div>
        </div>
      </main>

      {/* Task Detail SlideOver */}
      <SlideOver
        open={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        title={selectedTask?.type === 'Refill' ? 'Refill Request' : selectedTask?.type === 'LabReview' ? 'Lab Results' : 'Sign Note'}
      >
        {selectedTask && (
          <div className="space-y-6">
            <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-xl border">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center font-display text-lg text-primary">
                {selectedTask.patientName.split(' ').map(n => n[0]).join('')}
              </div>
              <div>
                <h3 className="font-display text-xl">{selectedTask.patientName}</h3>
                <p className="font-mono text-xs text-muted-foreground">
                  DOB: 01/01/1980 · MRN: {selectedTask.id}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="font-mono text-xs text-muted-foreground uppercase tracking-widest">
                Details
              </h4>
              <div className="p-4 border rounded-xl bg-card">
                <p className="font-medium">{selectedTask.details}</p>
                <p className="font-mono text-xs text-muted-foreground mt-2">
                  Requested today at 9:00 AM
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="font-mono text-xs text-muted-foreground uppercase tracking-widest">
                Actions
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <Button className="w-full font-mono text-xs" onClick={() => setSelectedTask(null)}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Approve
                </Button>
                <Button variant="outline" className="w-full font-mono text-xs" onClick={() => setSelectedTask(null)}>
                  <Clock className="mr-2 h-4 w-4" />
                  Defer
                </Button>
              </div>
              <Button
                variant="ghost"
                className="w-full font-mono text-xs text-[oklch(0.65_0.22_15)] hover:text-[oklch(0.65_0.22_15)] hover:bg-[oklch(0.65_0.22_15_/_0.1)]"
              >
                Deny Request
              </Button>
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  );
}

/**
 * ChronicleAppointmentCard - Appointment card in Chronicle style
 */
function ChronicleAppointmentCard({ appointment, index, onClick }) {
  const { patientName, time, type, chiefComplaint, status } = appointment;

  const getStatusConfig = (status) => {
    switch (status) {
      case 'in-room':
        return { badge: 'badge-chronicle-emerald', label: 'In Room', ribbon: 'status-ribbon-stable' };
      case 'checked-in':
        return { badge: 'badge-chronicle-amber', label: 'Checked In', ribbon: 'status-ribbon-warning' };
      case 'telehealth-active':
        return { badge: 'badge-chronicle-sky', label: 'Active Call', ribbon: null, pulse: true };
      default:
        return { badge: 'font-mono text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground', label: 'Upcoming', ribbon: null };
    }
  };

  const statusConfig = getStatusConfig(status);

  return (
    <article
      className={cn(
        "group relative bg-card/50 border border-border rounded-xl p-5",
        "hover:border-primary/30 hover:shadow-[0_0_20px_-8px_var(--chronicle-amber)]",
        "transition-all duration-300 cursor-pointer",
        "animate-chronicle-enter"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={onClick}
    >
      {statusConfig.ribbon && <div className={cn("status-ribbon", statusConfig.ribbon)} />}

      <div className="flex items-center gap-4">
        {/* Time Column */}
        <div className="flex flex-col items-center min-w-[60px]">
          <span className="font-mono text-lg font-semibold text-foreground">{time}</span>
          <span className="font-mono text-[10px] uppercase text-muted-foreground">{type}</span>
        </div>

        {/* Avatar */}
        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center font-display text-primary border-2 border-background">
          {patientName.split(' ').map(n => n[0]).join('')}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-display text-xl text-foreground truncate">
              {patientName}
            </h3>
            <span className={cn(statusConfig.badge, statusConfig.pulse && 'animate-pulse')}>
              {status === 'telehealth-active' && <Video className="w-3 h-3 mr-1 inline" />}
              {statusConfig.label}
            </span>
          </div>
          <p className="text-sm text-muted-foreground truncate">
            {chiefComplaint}
          </p>
        </div>

        {/* Hover Action */}
        <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </article>
  );
}

/**
 * ChronicleInbox - Task inbox in Chronicle style
 */
function ChronicleInbox({ tasks, selectedTask, onSelectTask }) {
  const getTaskIcon = (type) => {
    switch (type) {
      case 'Refill':
        return <Pill className="h-4 w-4 text-[oklch(0.70_0.15_230)]" />;
      case 'LabReview':
        return <FlaskConical className="h-4 w-4 text-[oklch(0.70_0.17_155)]" />;
      case 'SignNote':
        return <FileText className="h-4 w-4 text-primary" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const TaskList = ({ filter }) => {
    const filteredTasks = filter === 'All' ? tasks : tasks.filter(t => t.type === filter);

    if (filteredTasks.length === 0) {
      return (
        <div className="p-8 text-center">
          <p className="font-mono text-xs text-muted-foreground">No tasks found.</p>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {filteredTasks.map((task, index) => (
          <article
            key={task.id}
            className={cn(
              "group relative bg-card/50 border border-border rounded-xl p-4",
              "hover:border-primary/30 hover:bg-card transition-all cursor-pointer",
              "animate-chronicle-enter"
            )}
            style={{ animationDelay: `${index * 50}ms` }}
            onClick={() => onSelectTask(task)}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-background border shadow-sm flex items-center justify-center">
                {getTaskIcon(task.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display text-base truncate">{task.patientName}</span>
                  <span className={cn(
                    "font-mono text-[10px] px-2 py-0.5 rounded",
                    task.priority === 'Urgent'
                      ? 'bg-[oklch(0.65_0.22_15_/_0.1)] text-[oklch(0.65_0.22_15)]'
                      : 'bg-muted text-muted-foreground'
                  )}>
                    {task.priority}
                  </span>
                </div>
                <p className="font-mono text-xs text-muted-foreground truncate">{task.details}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </article>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-card border border-border rounded-2xl h-full flex flex-col animate-chronicle-enter">
      <header className="px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Inbox className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-display text-2xl text-foreground">Inbox</h2>
          <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </div>
      </header>

      <Tabs defaultValue="All" className="flex-1 flex flex-col min-h-0">
        <div className="px-6 border-b border-border">
          <TabsList className="w-full justify-start h-10 p-0 bg-transparent rounded-none gap-4">
            <TabsTrigger
              value="All"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2 font-mono text-xs"
            >
              All
            </TabsTrigger>
            <TabsTrigger
              value="Refill"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2 font-mono text-xs"
            >
              Refills
            </TabsTrigger>
            <TabsTrigger
              value="LabReview"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2 font-mono text-xs"
            >
              Labs
            </TabsTrigger>
            <TabsTrigger
              value="SignNote"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2 font-mono text-xs"
            >
              Signatures
            </TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="flex-1 px-6 py-4">
          <TabsContent value="All" className="mt-0"><TaskList filter="All" /></TabsContent>
          <TabsContent value="Refill" className="mt-0"><TaskList filter="Refill" /></TabsContent>
          <TabsContent value="LabReview" className="mt-0"><TaskList filter="LabReview" /></TabsContent>
          <TabsContent value="SignNote" className="mt-0"><TaskList filter="SignNote" /></TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
