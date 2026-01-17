import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
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

  // Function to determine if patient needs attention
  const needsAttention = (patient) => {
    // This is a placeholder. In a real application, this would check for:
    // - Overdue medications
    // - Abnormal vital signs
    // - Pending tasks
    // - etc.
    
    // For demo purposes, we'll randomly mark some patients as needing attention
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
              const requiresAttention = needsAttention(patient);
              
              return (
                <div
                  key={patient.id}
                  className={`p-4 border rounded-md cursor-pointer hover:bg-muted transition-colors ${
                    requiresAttention ? 'border-red-300 bg-red-50' : ''
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
                      {requiresAttention && (
                        <Badge variant="destructive" className="mb-1">
                          Needs Attention
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
                      <span className="text-muted-foreground">Doctor:</span>{' '}
                      {patient.admission.admitting_doctor?.user.full_name || 'Not assigned'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Type:</span>{' '}
                      {patient.admission.admission_type.replace('_', ' ')}
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