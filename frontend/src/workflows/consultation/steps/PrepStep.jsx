import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User, Calendar, AlertTriangle, Pill, FileText } from 'lucide-react';

/**
 * PrepStep Component
 * Auto-loaded patient context and history review
 * No user input required, just displays information
 */
export function PrepStep({ contextData, patient }) {
  const prepData = contextData?.prep_data || {};

  return (
    <div className="space-y-6">
      {/* Patient Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Patient Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Name</p>
              <p className="font-medium">{prepData.patient_name || 'Unknown'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">MRN</p>
              <p className="font-medium">{prepData.medical_record_number || 'N/A'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alerts */}
      {prepData.alerts && prepData.alerts.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Clinical Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {prepData.alerts.map((alert, index) => (
                <div key={index} className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/10 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                  <span className="text-sm">{alert}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Problems */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Active Problems
          </CardTitle>
        </CardHeader>
        <CardContent>
          {prepData.active_problems && prepData.active_problems.length > 0 ? (
            <ul className="space-y-2">
              {prepData.active_problems.map((problem, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>{problem}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No active problems on record</p>
          )}
        </CardContent>
      </Card>

      {/* Current Medications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Pill className="h-5 w-5" />
            Current Medications
          </CardTitle>
        </CardHeader>
        <CardContent>
          {prepData.current_medications && prepData.current_medications.length > 0 ? (
            <div className="space-y-2">
              {prepData.current_medications.map((med, index) => (
                <div key={index} className="p-3 border rounded-lg">
                  <p className="font-medium">{med.name}</p>
                  {med.dose && <p className="text-sm text-muted-foreground">{med.dose}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No current medications on record</p>
          )}
        </CardContent>
      </Card>

      {/* Last Visit */}
      {prepData.last_visit && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Last Visit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div>
                <p className="text-sm text-muted-foreground">Date</p>
                <p className="font-medium">{prepData.last_visit.date}</p>
              </div>
              {prepData.last_visit.summary && (
                <div>
                  <p className="text-sm text-muted-foreground">Summary</p>
                  <p className="text-sm">{prepData.last_visit.summary}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Results */}
      {prepData.recent_results && prepData.recent_results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Lab Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {prepData.recent_results.map((result, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium">{result.test}</p>
                    <p className="text-sm text-muted-foreground">{result.date}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{result.value}</p>
                    {result.abnormal && (
                      <Badge variant="destructive" className="text-xs">Abnormal</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info message */}
      <div className="text-sm text-muted-foreground text-center py-4">
        Review the patient information above, then click Continue to begin documentation.
      </div>
    </div>
  );
}
