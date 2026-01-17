import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Heart from 'lucide-react/dist/esm/icons/heart.js';
import Droplet from 'lucide-react/dist/esm/icons/droplet.js';
import Thermometer from 'lucide-react/dist/esm/icons/thermometer.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import TrendingDown from 'lucide-react/dist/esm/icons/trending-down.js';
import Minus from 'lucide-react/dist/esm/icons/minus.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Bell from 'lucide-react/dist/esm/icons/bell.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';

/**
 * Monitoring Mode Layout
 * Vitals and alerts prominent for active patient monitoring
 * Designed for ward rounds, ICU, or continuous monitoring scenarios
 */
export function MonitoringModeLayout({ encounter, formatDate, getStatusBadge }) {
  // Mock vital signs data with trends
  const vitalSigns = [
    {
      id: 1,
      name: 'Blood Pressure',
      value: '130/80',
      unit: 'mmHg',
      status: 'normal',
      trend: 'stable',
      icon: Heart,
      lastUpdated: '2 mins ago',
      history: ['125/78', '128/82', '130/80'],
    },
    {
      id: 2,
      name: 'Heart Rate',
      value: '78',
      unit: 'bpm',
      status: 'normal',
      trend: 'stable',
      icon: Activity,
      lastUpdated: '2 mins ago',
      history: ['76', '77', '78'],
    },
    {
      id: 3,
      name: 'SpO2',
      value: '98',
      unit: '%',
      status: 'normal',
      trend: 'up',
      icon: Droplet,
      lastUpdated: '2 mins ago',
      history: ['96', '97', '98'],
    },
    {
      id: 4,
      name: 'Temperature',
      value: '37.2',
      unit: '°C',
      status: 'normal',
      trend: 'stable',
      icon: Thermometer,
      lastUpdated: '5 mins ago',
      history: ['37.1', '37.2', '37.2'],
    },
  ];

  const alerts = [
    {
      id: 1,
      severity: 'high',
      title: 'Low Hemoglobin',
      message: 'Hb 10.8 g/dL — consider iron studies',
      time: '10 mins ago',
      actionable: true,
    },
    {
      id: 2,
      severity: 'medium',
      title: 'Medication Due',
      message: 'Metformin 500mg due in 15 minutes',
      time: '5 mins ago',
      actionable: true,
    },
  ];

  const pendingTasks = [
    { id: 1, task: 'Order iron studies', priority: 'high', dueIn: '2 hours' },
    { id: 2, task: 'Administer Metformin 500mg', priority: 'urgent', dueIn: '15 mins' },
    { id: 3, task: 'Follow-up labs review', priority: 'medium', dueIn: '4 hours' },
  ];

  const getTrendIcon = (trend) => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'down':
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      default:
        return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'critical':
        return 'bg-red-500';
      case 'warning':
        return 'bg-amber-500';
      case 'normal':
        return 'bg-green-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getSeverityVariant = (severity) => {
    switch (severity) {
      case 'high':
        return 'destructive';
      case 'medium':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent':
        return 'destructive';
      case 'high':
        return 'warning';
      default:
        return 'secondary';
    }
  };

  return (
    <div className="space-y-4">
      {/* Patient Header Bar */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <User className="h-8 w-8 text-primary" />
              <div>
                <h2 className="text-xl font-semibold">{encounter.patient_name || 'Unknown Patient'}</h2>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{encounter.encounter_type}</span>
                  <Separator orientation="vertical" className="h-4" />
                  <span>{encounter.practitioner_name}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {getStatusBadge(encounter.status)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Two Column Layout: Vitals + Alerts/Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT: Large Vitals Display */}
        <div className="lg:col-span-2 space-y-4">
          {/* Vital Signs Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {vitalSigns.map((vital) => {
              const Icon = vital.icon;
              return (
                <Card key={vital.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full ${getStatusColor(vital.status)}`} />
                        <CardTitle className="text-sm font-medium">{vital.name}</CardTitle>
                      </div>
                      {getTrendIcon(vital.trend)}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex items-baseline gap-2">
                        <Icon className="h-6 w-6 text-muted-foreground" />
                        <span className="text-3xl font-bold">{vital.value}</span>
                        <span className="text-lg text-muted-foreground">{vital.unit}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>{vital.lastUpdated}</span>
                      </div>
                      {/* Mini trend */}
                      <div className="flex gap-1 pt-2">
                        {vital.history.map((val, idx) => (
                          <div
                            key={idx}
                            className="flex-1 h-8 bg-primary/10 rounded flex items-end justify-center text-xs"
                          >
                            <span className="pb-1">{val}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Medication Schedule */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Pill className="h-5 w-5" />
                Medication Schedule
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <div className="font-medium">Metformin 500mg</div>
                    <div className="text-sm text-muted-foreground">Due in 15 minutes</div>
                  </div>
                  <Badge variant="destructive">Due</Badge>
                </div>
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <div className="font-medium">Lisinopril 10mg</div>
                    <div className="text-sm text-muted-foreground">Next dose: 18:00</div>
                  </div>
                  <Badge variant="outline">Scheduled</Badge>
                </div>
                <div className="flex items-center justify-between p-3 border rounded-lg opacity-60">
                  <div>
                    <div className="font-medium">Aspirin 75mg</div>
                    <div className="text-sm text-muted-foreground">Administered: 09:00</div>
                  </div>
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: Alerts & Tasks */}
        <div className="lg:col-span-1 space-y-4">
          {/* Critical Alerts */}
          <Card className="border-red-200 dark:border-red-900">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-5 w-5 text-red-500" />
                Active Alerts
                <Badge variant="destructive" className="ml-auto">
                  {alerts.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {alerts.map((alert) => (
                <Alert key={alert.id} variant={getSeverityVariant(alert.severity)}>
                  <AlertDescription className="space-y-2">
                    <div>
                      <div className="font-semibold text-sm">{alert.title}</div>
                      <div className="text-xs mt-1">{alert.message}</div>
                      <div className="text-xs text-muted-foreground mt-1">{alert.time}</div>
                    </div>
                    {alert.actionable && (
                      <Button size="sm" variant="outline" className="w-full mt-2">
                        Take Action
                      </Button>
                    )}
                  </AlertDescription>
                </Alert>
              ))}
            </CardContent>
          </Card>

          {/* Pending Tasks */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-5 w-5" />
                Pending Tasks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {pendingTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex-1">
                      <div className="text-sm font-medium">{task.task}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Due in {task.dueIn}
                      </div>
                    </div>
                    <Badge variant={getPriorityColor(task.priority)} className="text-xs">
                      {task.priority}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start" size="sm">
                <Activity className="mr-2 h-4 w-4" />
                Record Vitals
              </Button>
              <Button variant="outline" className="w-full justify-start" size="sm">
                <Pill className="mr-2 h-4 w-4" />
                Administer Medication
              </Button>
              <Button variant="outline" className="w-full justify-start" size="sm">
                <AlertTriangle className="mr-2 h-4 w-4" />
                Report Issue
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
