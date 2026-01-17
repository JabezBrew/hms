import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

export function PatientList({ patients, onPatientSelect }) {
  // Function to calculate time since admission
  const getTimeSinceAdmission = (admissionDate) => {
    const now = new Date();
    const admitted = new Date(admissionDate);
    const diffTime = Math.abs(now - admitted);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (diffDays > 0) {
      return `${diffDays}d ${diffHours}h`;
    }
    return `${diffHours}h`;
  };

  // Function to determine if patient has pending tasks
  const hasPendingTasks = (patient) => {
    // This is a placeholder. In a real application, this would check for:
    // - Pending lab results
    // - Pending medication orders
    // - Pending consultations
    // - etc.
    
    // For demo purposes, we'll randomly mark some patients as having pending tasks
    return Math.random() > 0.6;
  };

  // Function to determine if patient has new results
  const hasNewResults = (patient) => {
    // This is a placeholder. In a real application, this would check for:
    // - New lab results
    // - New imaging results
    // - New vital signs
    // - etc.
    
    // For demo purposes, we'll randomly mark some patients as having new results
    return Math.random() > 0.7;
  };

  if (patients.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center p-6">
          <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-lg font-medium">No patients found</p>
          <p className="text-muted-foreground">
            There are no admitted patients in this ward or your search returned no results.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Patients</CardTitle>
        <CardDescription>
          {patients.length} patient{patients.length !== 1 ? 's' : ''} currently admitted
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-4">
          <div className="space-y-4">
            {patients.map(patient => {
              const pendingTasks = hasPendingTasks(patient);
              const newResults = hasNewResults(patient);
              
              return (
                <div
                  key={patient.id}
                  className={`p-4 border rounded-md cursor-pointer hover:bg-muted transition-colors ${
                    pendingTasks ? 'border-amber-300 bg-amber-50' : 
                    newResults ? 'border-blue-300 bg-blue-50' : ''
                  }`}
                  onClick={() => onPatientSelect(patient)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-medium">{patient.user.full_name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {patient.bed.ward.name} - Bed {patient.bed.bed_number}
                      </p>
                    </div>
                    <div className="flex flex-col items-end">
                      {pendingTasks && (
                        <Badge variant="warning" className="mb-1">
                          Pending Tasks
                        </Badge>
                      )}
                      {newResults && (
                        <Badge variant="info" className="mb-1">
                          New Results
                        </Badge>
                      )}
                      <div className="flex items-center text-sm text-muted-foreground">
                        <Clock className="h-3 w-3 mr-1" />
                        {getTimeSinceAdmission(patient.admission.admission_date)}
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Age:</span>{' '}
                      {patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'N/A'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Gender:</span>{' '}
                      {patient.gender || 'N/A'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Admission:</span>{' '}
                      {patient.admission.admission_type.replace('_', ' ')}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Expected Discharge:</span>{' '}
                      {patient.admission.expected_discharge_date ? 
                        new Date(patient.admission.expected_discharge_date).toLocaleDateString() : 
                        'Not set'}
                    </div>
                  </div>
                  
                  <div className="mt-3 flex flex-wrap gap-2">
                    <div className="flex items-center text-xs bg-gray-100 rounded-full px-2 py-1">
                      <Activity className="h-3 w-3 mr-1 text-blue-500" />
                      <span>Vitals</span>
                    </div>
                    <div className="flex items-center text-xs bg-gray-100 rounded-full px-2 py-1">
                      <FileText className="h-3 w-3 mr-1 text-green-500" />
                      <span>Notes</span>
                    </div>
                    <div className="flex items-center text-xs bg-gray-100 rounded-full px-2 py-1">
                      <Pill className="h-3 w-3 mr-1 text-purple-500" />
                      <span>Meds</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}