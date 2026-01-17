import Activity from 'lucide-react/dist/esm/icons/activity.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Heart from 'lucide-react/dist/esm/icons/heart.js';
import Thermometer from 'lucide-react/dist/esm/icons/thermometer.js';
import Wind from 'lucide-react/dist/esm/icons/wind.js';
import Droplets from 'lucide-react/dist/esm/icons/droplets.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { useNavigate } from 'react-router-dom';

export function PatientMonitoringCard({ patientData }) {
  const navigate = useNavigate();
  const { patient, admission, latest_vitals, active_alerts, pending_tasks, medications_due } = patientData;

  // Handle nested user_details structure
  const patientUser = patient?.user_details || patient?.user || {};
  const fullName = patientUser.full_name || `${patientUser.first_name || ''} ${patientUser.last_name || ''}`.trim() || 'Unknown Patient';

  // Get severity color
  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-500 text-white';
      case 'high':
        return 'bg-orange-500 text-white';
      case 'medium':
        return 'bg-yellow-500 text-white';
      case 'low':
        return 'bg-blue-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  // Get vital sign status
  const getVitalStatus = (vital, value) => {
    if (!value) return 'normal';

    switch (vital) {
      case 'temperature':
        if (value < 36.0 || value > 39.0) return 'critical';
        if (value < 36.5 || value > 38.0) return 'warning';
        return 'normal';
      case 'heart_rate':
        if (value < 50 || value > 120) return 'critical';
        if (value < 60 || value > 100) return 'warning';
        return 'normal';
      case 'oxygen_saturation':
        if (value < 92) return 'critical';
        if (value < 95) return 'warning';
        return 'normal';
      default:
        return 'normal';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'critical':
        return 'text-red-600';
      case 'warning':
        return 'text-yellow-600';
      default:
        return 'text-green-600';
    }
  };

  const handleViewDetails = () => {
    navigate(`/nursing/patient/${patient.id}`);
  };

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <CardTitle className="text-lg">{fullName}</CardTitle>
            <div className="text-sm text-muted-foreground mt-1">
              {admission?.bed_details?.ward_details?.name} - Bed {admission?.bed_details?.bed_number}
            </div>
            <div className="text-xs text-muted-foreground">
              MRN: {patient?.medical_record_number || 'N/A'}
            </div>
          </div>

          {/* Alert Count Badge */}
          {active_alerts && active_alerts.length > 0 && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {active_alerts.length}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Vital Signs */}
        {latest_vitals ? (
          <div className="grid grid-cols-2 gap-2">
            {latest_vitals.temperature && (
              <div className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                <Thermometer className={`h-4 w-4 ${getStatusColor(getVitalStatus('temperature', latest_vitals.temperature))}`} />
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground">Temp</div>
                  <div className="text-sm font-medium">{latest_vitals.temperature}°C</div>
                </div>
              </div>
            )}

            {latest_vitals.heart_rate && (
              <div className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                <Heart className={`h-4 w-4 ${getStatusColor(getVitalStatus('heart_rate', latest_vitals.heart_rate))}`} />
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground">HR</div>
                  <div className="text-sm font-medium">{latest_vitals.heart_rate} bpm</div>
                </div>
              </div>
            )}

            {latest_vitals.blood_pressure && (
              <div className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                <Activity className="h-4 w-4" />
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground">BP</div>
                  <div className="text-sm font-medium">{latest_vitals.blood_pressure} mmHg</div>
                </div>
              </div>
            )}

            {latest_vitals.oxygen_saturation && (
              <div className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                <Wind className={`h-4 w-4 ${getStatusColor(getVitalStatus('oxygen_saturation', latest_vitals.oxygen_saturation))}`} />
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground">SpO2</div>
                  <div className="text-sm font-medium">{latest_vitals.oxygen_saturation}%</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground p-2 bg-gray-50 rounded">
            No recent vital signs recorded
          </div>
        )}

        {/* Active Alerts */}
        {active_alerts && active_alerts.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Active Alerts</div>
            <div className="space-y-1">
              {active_alerts.slice(0, 2).map((alert) => (
                <div key={alert.id} className="flex items-start gap-2 text-xs p-2 bg-red-50 rounded">
                  <AlertTriangle className="h-3 w-3 text-red-600 mt-0.5 flex-shrink-0" />
                  <span className="text-red-800">{alert.message}</span>
                </div>
              ))}
              {active_alerts.length > 2 && (
                <div className="text-xs text-muted-foreground">
                  +{active_alerts.length - 2} more alerts
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quick Stats */}
        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <ClipboardList className="h-3 w-3" />
              <span>{pending_tasks?.length || 0} Tasks</span>
            </div>
            <div className="flex items-center gap-1">
              <Pill className="h-3 w-3" />
              <span>{medications_due?.length || 0} Meds</span>
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handleViewDetails}
          >
            View Details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
