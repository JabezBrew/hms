import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import VirtualizedTable from '@/components/ui/VirtualizedTable';

export function PatientList({ patients, onPatientSelect }) {
  const getTimeSinceAdmission = (admissionDate) => {
    if (!admissionDate) return 'N/A';
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

  const getPatientName = (patient) => patient?.user?.full_name || 'Unknown Patient';

  const getAge = (dateOfBirth) => {
    if (!dateOfBirth) return 'N/A';
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age -= 1;
    }
    return age >= 0 ? `${age}y` : 'N/A';
  };

  const getAdmissionTypeLabel = (value) =>
    value ? value.replaceAll('_', ' ') : 'Not specified';

  const columns = [
    {
      key: 'patient',
      header: 'Patient',
      width: '220px',
      render: (patient) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{getPatientName(patient)}</p>
          <p className="truncate text-xs text-muted-foreground">{patient?.id || 'No patient ID'}</p>
        </div>
      ),
    },
    {
      key: 'bed',
      header: 'Ward / Bed',
      width: '220px',
      render: (patient) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-foreground">{patient?.bed?.ward?.name || 'Unassigned ward'}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Bed className="h-3 w-3" />
            Bed {patient?.bed?.bed_number || 'Unassigned'}
          </p>
        </div>
      ),
    },
    {
      key: 'demographics',
      header: 'Demographics',
      width: '160px',
      render: (patient) => (
        <div className="space-y-1">
          <p className="text-sm text-foreground">{getAge(patient?.date_of_birth)}</p>
          <p className="text-xs capitalize text-muted-foreground">{patient?.gender || 'Not recorded'}</p>
        </div>
      ),
    },
    {
      key: 'admission',
      header: 'Admission',
      width: '200px',
      render: (patient) => (
        <div className="space-y-1">
          <Badge variant="outline" className="text-xs capitalize">
            {getAdmissionTypeLabel(patient?.admission?.admission_type)}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {patient?.admission?.admission_date ? new Date(patient.admission.admission_date).toLocaleDateString() : 'No admission date'}
          </p>
        </div>
      ),
    },
    {
      key: 'stay',
      header: 'Length Of Stay',
      width: '160px',
      render: (patient) => (
        <div className="flex items-center gap-1 text-sm text-foreground">
          <Clock className="h-3 w-3 text-muted-foreground" />
          {getTimeSinceAdmission(patient?.admission?.admission_date)}
        </div>
      ),
    },
    {
      key: 'expected_discharge',
      header: 'Expected Discharge',
      width: '200px',
      render: (patient) => (
        <div className="space-y-1">
          <p className="flex items-center gap-1 text-sm text-foreground">
            <Calendar className="h-3 w-3 text-muted-foreground" />
            {patient?.admission?.expected_discharge_date
              ? new Date(patient.admission.expected_discharge_date).toLocaleDateString()
              : 'Not scheduled'}
          </p>
          <p className="text-xs text-muted-foreground capitalize">
            {patient?.admission?.status || 'Admitted'}
          </p>
        </div>
      ),
    },
  ];

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
        <div className="overflow-x-auto">
          <VirtualizedTable
            rows={patients}
            columns={columns}
            rowKey={(patient) => patient.id}
            rowHeight={72}
            useWindow={false}
            height={500}
            threshold={8}
            onRowClick={onPatientSelect}
            rowClassName="hover:bg-muted/30"
            className="min-w-[1160px]"
            headerClassName="border-b border-border bg-muted/50"
          />
        </div>
      </CardContent>
    </Card>
  );
}
